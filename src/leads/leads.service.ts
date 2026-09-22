import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadStatus } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { CaptchaService } from '../captcha/captcha.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import type { CreateLeadDto } from './dto/create-lead.dto';
import type { LeadNotification } from './lead-notification.interface';

export type UploadedLeadFile = {
  originalname: string;
  filename: string;
  mimetype: string;
  size: number;
};

export type LeadMeta = { ip?: string; userAgent?: string; referer?: string };

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
    private readonly captcha: CaptchaService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateLeadDto, files: UploadedLeadFile[], meta: LeadMeta) {
    // 1. Ловушка для ботов: поле company скрыто в форме и у людей всегда пустое
    if (dto.company) {
      await this.removeFiles(files);
      this.logger.warn(`Заявка отклонена антиспамом (honeypot), ip=${meta.ip}`);
      // отвечаем как при успехе, чтобы бот не подбирал обход
      return { ok: true as const, id: 'spam' };
    }

    // 2. Капча
    const captchaOk = await this.captcha.verify(dto.captchaToken, meta.ip);
    if (!captchaOk) {
      await this.removeFiles(files);
      throw new BadRequestException({ ok: false, error: 'captcha', message: 'Подтвердите, что вы не робот' });
    }

    const normalized = {
      name: dto.name.trim(),
      phone: dto.phone.trim(),
      email: dto.email?.trim() || null,
      task: dto.task.trim(),
      page: dto.page?.trim() || null,
    };

    // 3. Сохраняем в БД (если она недоступна — продолжаем, заявка важнее истории)
    let leadId = `tmp_${Date.now().toString(36)}`;
    let stored = false;
    try {
      const lead = await this.prisma.lead.create({
        data: {
          ...normalized,
          ip: meta.ip,
          userAgent: meta.userAgent,
          referer: meta.referer,
          files: {
            create: files.map((f) => ({
              storedName: f.filename,
              originalName: f.originalname,
              mimeType: f.mimetype,
              size: f.size,
            })),
          },
        },
      });
      leadId = lead.id;
      stored = true;
    } catch (e) {
      this.logger.error('Заявка не сохранена в БД: ' + (e as Error).message);
    }

    const notification: LeadNotification = {
      id: leadId,
      createdAt: new Date(),
      ...normalized,
      ip: meta.ip,
      files: files.map((f) => ({
        originalName: f.originalname,
        storedName: f.filename,
        mimeType: f.mimetype,
        size: f.size,
      })),
    };

    // 4. Доставка: почта и Telegram независимо друг от друга
    const errors: string[] = [];
    let mailSentAt: Date | null = null;
    let telegramSentAt: Date | null = null;

    if (this.mail.enabled) {
      try {
        await this.mail.send(notification);
        mailSentAt = new Date();
      } catch (e) {
        errors.push('почта: ' + (e as Error).message);
        this.logger.error('Ошибка отправки почты: ' + (e as Error).message);
      }
    }

    if (this.telegram.enabled) {
      try {
        await this.telegram.send(notification);
        telegramSentAt = new Date();
      } catch (e) {
        errors.push('telegram: ' + (e as Error).message);
        this.logger.error('Ошибка отправки в Telegram: ' + (e as Error).message);
      }
    }

    const delivered = !!mailSentAt || !!telegramSentAt;
    if (!this.mail.enabled && !this.telegram.enabled) {
      this.logger.warn(`Каналы доставки не настроены — заявка №${leadId} только в БД/логе`);
      this.logger.log(`[lead] ${JSON.stringify({ ...normalized, files: files.length })}`);
    }

    if (stored) {
      await this.prisma.lead
        .update({
          where: { id: leadId },
          data: {
            status: delivered || (!this.mail.enabled && !this.telegram.enabled) ? LeadStatus.SENT : LeadStatus.FAILED,
            mailSentAt,
            telegramSentAt,
            deliveryError: errors.length ? errors.join('; ') : null,
          },
        })
        .catch(() => undefined);
    }

    // Заявку считаем принятой, если она сохранена или доставлена хотя бы одним каналом
    if (!stored && !delivered && (this.mail.enabled || this.telegram.enabled)) {
      throw new BadRequestException({
        ok: false,
        error: 'delivery',
        message: 'Не удалось отправить заявку. Позвоните нам или напишите на почту.',
      });
    }

    return { ok: true as const, id: leadId };
  }

  /** Список заявок для служебного доступа (заголовок X-Admin-Key). */
  async list(limit = 50, offset = 0) {
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
        skip: offset,
        include: { files: true },
      }),
      this.prisma.lead.count(),
    ]);
    return { total, items };
  }

  private async removeFiles(files: UploadedLeadFile[]) {
    const dir = this.config.get<string>('uploads.dir')!;
    await Promise.all(files.map((f) => unlink(path.join(dir, f.filename)).catch(() => undefined)));
  }
}
