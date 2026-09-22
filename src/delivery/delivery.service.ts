import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadStatus, type Lead, type LeadFile, type Prisma } from '@prisma/client';
import { moscowTime, since } from '../common/time';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import type { LeadNotification } from '../leads/lead-notification.interface';

type Channel = 'telegram' | 'mail';

const TITLE: Record<Channel, string> = { telegram: 'Telegram', mail: 'почта' };
/** «не уходят …» — чтобы заголовок предупреждения читался по-русски */
const WHERE_TO: Record<Channel, string> = { telegram: 'в Telegram', mail: 'на почту' };

/**
 * Фоновое обслуживание доставки заявок:
 *  1) досылает заявки, которые не ушли (лежал прокси, отвалился SMTP);
 *  2) следит за каналами и, если канал молчит дольше DELIVERY_ALERT_HOURS,
 *     предупреждает через соседний канал — про Telegram письмом, про почту в Telegram.
 * Заявки при этом не теряются: они сохранены в базе.
 */
@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  /** Когда и с каким исходом канал проверяли в последний раз (в памяти процесса). */
  private readonly lastProbe = new Map<Channel, { at: number; ok: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const minutes = this.config.get<number>('delivery.retryMinutes')!;
    if (minutes <= 0) {
      this.logger.log('Фоновая дослыка выключена (DELIVERY_RETRY_MINUTES=0)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    // первый прогон вскоре после старта: дослать то, что не ушло, пока сервис лежал
    setTimeout(() => void this.tick(), 60_000).unref();
    this.logger.log(
      `Фоновая дослыка заявок: каждые ${minutes} мин; тревога, если канал молчит ` +
        `дольше ${this.config.get<number>('delivery.alertHours')} ч`,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Один проход: дослать недоставленное и проверить каналы. */
  async tick(): Promise<void> {
    if (this.busy) return; // предыдущий проход ещё идёт (медленный SMTP, большие вложения)
    this.busy = true;
    try {
      await this.resendPending();
      await this.watchChannels();
    } catch (e) {
      this.logger.error('Сбой фонового обслуживания: ' + msg(e));
    } finally {
      this.busy = false;
    }
  }

  /** Повторная отправка заявок, которые не ушли в один из каналов. */
  async resendPending(): Promise<number> {
    const pending: Prisma.LeadWhereInput[] = [];
    if (this.mail.enabled) pending.push({ mailSentAt: null });
    if (this.telegram.enabled) pending.push({ telegramSentAt: null });
    if (!pending.length) return 0;

    const leads = await this.prisma.lead.findMany({
      where: { createdAt: { gte: this.retryFrom() }, status: { not: LeadStatus.SPAM }, OR: pending },
      include: { files: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    if (!leads.length) return 0;

    let resent = 0;
    for (const lead of leads) {
      const notification = toNotification(lead);
      const errors: string[] = [];
      let mailSentAt = lead.mailSentAt;
      let telegramSentAt = lead.telegramSentAt;

      if (this.mail.enabled && !mailSentAt) {
        try {
          await this.mail.send(notification);
          mailSentAt = new Date();
          resent++;
        } catch (e) {
          errors.push('почта: ' + msg(e));
        }
      }

      if (this.telegram.enabled && !telegramSentAt) {
        try {
          await this.telegram.send(notification);
          telegramSentAt = new Date();
          resent++;
        } catch (e) {
          errors.push('telegram: ' + msg(e));
        }
      }

      await this.prisma.lead
        .update({
          where: { id: lead.id },
          data: {
            mailSentAt,
            telegramSentAt,
            status: mailSentAt || telegramSentAt ? LeadStatus.SENT : LeadStatus.FAILED,
            deliveryError: errors.length ? errors.join('; ') : null,
          },
        })
        .catch((e: unknown) => this.logger.error('Не удалось обновить заявку: ' + msg(e)));
    }

    if (resent) this.logger.log(`Дослано заявок: ${resent}`);
    return resent;
  }

  /** Проверка каналов и предупреждение, если канал лежит слишком долго. */
  async watchChannels(): Promise<void> {
    for (const channel of ['telegram', 'mail'] as Channel[]) {
      if (!this.isEnabled(channel) || !this.shouldProbe(channel)) continue;
      const res = channel === 'telegram' ? await this.telegram.check() : await this.mail.check();
      this.lastProbe.set(channel, { at: Date.now(), ok: res.ok });
      if (res.ok) await this.onUp(channel);
      else await this.onDown(channel, res.error || 'нет связи');
    }
  }

  /** Состояние доставки для служебного health-маршрута. */
  async status() {
    const from = this.retryFrom();
    const [telegramPending, mailPending] = await Promise.all([
      this.telegram.enabled
        ? this.prisma.lead.count({ where: { telegramSentAt: null, createdAt: { gte: from }, status: { not: LeadStatus.SPAM } } })
        : Promise.resolve(0),
      this.mail.enabled
        ? this.prisma.lead.count({ where: { mailSentAt: null, createdAt: { gte: from }, status: { not: LeadStatus.SPAM } } })
        : Promise.resolve(0),
    ]);
    return {
      retryMinutes: this.config.get<number>('delivery.retryMinutes'),
      alertHours: this.config.get<number>('delivery.alertHours'),
      telegram: { enabled: this.telegram.enabled, pending: telegramPending, lastOk: await this.getState('telegram:lastOk') },
      mail: { enabled: this.mail.enabled, pending: mailPending, lastOk: await this.getState('mail:lastOk') },
    };
  }

  // ── внутреннее ───────────────────────────────────────────────────────────

  private isEnabled(channel: Channel): boolean {
    return channel === 'telegram' ? this.telegram.enabled : this.mail.enabled;
  }

  /**
   * Живой канал проверяем раз в час: SMTP verify — это полноценный вход на почтовый
   * сервер, дёргать его каждые 10 минут незачем. Упавший проверяем каждый проход,
   * чтобы быстрее заметить починку и снять тревогу.
   */
  private shouldProbe(channel: Channel): boolean {
    const last = this.lastProbe.get(channel);
    return !last || !last.ok || Date.now() - last.at >= 3_600_000;
  }

  private retryFrom(): Date {
    return new Date(Date.now() - this.config.get<number>('delivery.retryDays')! * 86_400_000);
  }

  /** Канал отвечает: запоминаем время и, если была тревога, сообщаем о восстановлении. */
  private async onUp(channel: Channel): Promise<void> {
    const alertedAt = await this.getState(`${channel}:alertedAt`);
    await this.setState(`${channel}:lastOk`, new Date().toISOString());
    if (!alertedAt) return;

    await this.setState(`${channel}:alertedAt`, null);
    const text = `${TITLE[channel]} снова работает — заявки доставляются, недоставленные дошлются автоматически.`;
    this.logger.log(text);
    await this.notifyVia(other(channel), `Связь восстановлена: ${TITLE[channel]}`, [text]).catch(() => undefined);
  }

  /** Канал молчит: если дольше порога — предупреждаем через соседний канал. */
  private async onDown(channel: Channel, error: string): Promise<void> {
    const now = new Date();
    const lastOkRaw = await this.getState(`${channel}:lastOk`);
    if (!lastOkRaw) {
      // первая встреча с недоступным каналом: точку отсчёта ставим сейчас
      await this.setState(`${channel}:lastOk`, now.toISOString());
      this.logger.warn(`${TITLE[channel]}: нет связи (${error})`);
      return;
    }

    const lastOk = new Date(lastOkRaw);
    const downHours = (now.getTime() - lastOk.getTime()) / 3_600_000;
    if (downHours < this.config.get<number>('delivery.alertHours')!) {
      this.logger.warn(`${TITLE[channel]}: нет связи ${since(lastOk, now)} (${error})`);
      return;
    }

    const alertedRaw = await this.getState(`${channel}:alertedAt`);
    const repeatHours = this.config.get<number>('delivery.alertRepeatHours')!;
    if (alertedRaw && (now.getTime() - new Date(alertedRaw).getTime()) / 3_600_000 < repeatHours) return;

    const pending = await this.prisma.lead
      .count({
        where: {
          createdAt: { gte: this.retryFrom() },
          status: { not: LeadStatus.SPAM },
          ...(channel === 'telegram' ? { telegramSentAt: null } : { mailSentAt: null }),
        },
      })
      .catch(() => 0);

    const subject = `Заявки не уходят ${WHERE_TO[channel]} — нужно починить`;
    const lines = [
      `Канал «${TITLE[channel]}» не отвечает с ${moscowTime(lastOk)} — это уже ${since(lastOk, now)}.`,
      `Последняя ошибка: ${error}`,
      `Недоставленных заявок: ${pending}. Все они сохранены в базе, ничего не потеряно.`,
      '',
      channel === 'telegram'
        ? 'Чаще всего причина — перестал работать прокси до api.telegram.org (с российских адресов Bot API недоступен). Проверить: curl -s -H "X-Admin-Key: <ключ>" http://127.0.0.1:4000/api/health/telegram'
        : 'Проверьте SMTP_HOST / SMTP_USER / SMTP_PASS и пароль приложения у почтового провайдера.',
      `Когда связь восстановится, заявки дошлются автоматически в течение ${this.config.get<number>('delivery.retryMinutes')} мин.`,
    ];

    this.logger.error(`${subject}: молчит ${since(lastOk, now)}, недоставлено ${pending}`);
    try {
      await this.notifyVia(other(channel), subject, lines);
      await this.setState(`${channel}:alertedAt`, now.toISOString());
    } catch (e) {
      // оба канала лежат — остаётся только лог
      this.logger.error(`Предупредить через «${TITLE[other(channel)]}» тоже не вышло: ${msg(e)}`);
    }
  }

  /** Отправка предупреждения в тот канал, который ещё жив. */
  private async notifyVia(channel: Channel, subject: string, lines: string[]): Promise<void> {
    if (!this.isEnabled(channel)) throw new Error(`Канал «${TITLE[channel]}» не настроен`);
    if (channel === 'mail') await this.mail.sendAlert(`⚠️ ${subject}`, lines);
    else await this.telegram.sendNotice(`⚠️ <b>${subject}</b>\n\n${lines.join('\n')}`);
  }

  private async getState(key: string): Promise<string | null> {
    try {
      const row = await this.prisma.serviceState.findUnique({ where: { key } });
      return row?.value ?? null;
    } catch (e) {
      this.logger.error('Не прочитать служебное состояние: ' + msg(e));
      return null;
    }
  }

  private async setState(key: string, value: string | null): Promise<void> {
    try {
      await this.prisma.serviceState.upsert({ where: { key }, create: { key, value }, update: { value } });
    } catch (e) {
      this.logger.error('Не сохранить служебное состояние: ' + msg(e));
    }
  }
}

const other = (channel: Channel): Channel => (channel === 'telegram' ? 'mail' : 'telegram');
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Заявка из базы — в вид, пригодный для отправки. */
function toNotification(lead: Lead & { files: LeadFile[] }): LeadNotification {
  return {
    id: lead.id,
    createdAt: lead.createdAt,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    task: lead.task,
    page: lead.page,
    ip: lead.ip,
    files: lead.files.map((f) => ({
      originalName: f.originalName,
      storedName: f.storedName,
      mimeType: f.mimeType,
      size: f.size,
    })),
  };
}
