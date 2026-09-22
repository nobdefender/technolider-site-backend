import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import * as path from 'node:path';
import type { LeadNotification } from '../leads/lead-notification.interface';

/** Отправка заявок на почту (SMTP). Если SMTP_HOST не задан — отправка отключена. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    if (this.enabled) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('mail.host'),
        port: this.config.get<number>('mail.port'),
        secure: this.config.get<boolean>('mail.secure'),
        auth: {
          user: this.config.get<string>('mail.user'),
          pass: this.config.get<string>('mail.pass'),
        },
      });
    }
  }

  get enabled(): boolean {
    return !!this.config.get<boolean>('mail.enabled') && this.config.get<string[]>('mail.to')!.length > 0;
  }

  /** Служебная проверка связи с SMTP. */
  async check(): Promise<{ ok: boolean; error?: string }> {
    if (!this.transporter) return { ok: false, error: 'Отправка почты не настроена' };
    try {
      await this.transporter.verify();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Служебное письмо — тревога о канале доставки. Без вложений и без reply-to клиента. */
  async sendAlert(subject: string, lines: string[]): Promise<void> {
    if (!this.transporter) throw new Error('Отправка почты не настроена');
    const esc = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    await this.transporter.sendMail({
      from: this.config.get<string>('mail.from'),
      to: this.config.get<string[]>('mail.to')!,
      subject,
      text: lines.join('\n'),
      html: `<!doctype html><html lang="ru"><body style="margin:0;background:#f2f2f3;font-family:Arial,Helvetica,sans-serif;color:#1d1f20">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f3;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid rgba(29,31,32,.16)">
  <tr><td style="background:#7a2d2d;color:#f2f2f3;padding:20px 24px;font-size:18px;font-weight:bold">${esc(subject)}</td></tr>
  <tr><td style="padding:24px;font-size:15px;line-height:1.6">${lines.map((l) => esc(l)).join('<br>')}</td></tr>
</table></td></tr></table></body></html>`,
    });
    this.logger.warn(`Отправлено предупреждение на почту: ${subject}`);
  }

  async send(lead: LeadNotification): Promise<void> {
    if (!this.transporter) throw new Error('Отправка почты не настроена (нет SMTP_HOST или MAIL_TO)');

    const to = this.config.get<string[]>('mail.to')!;
    const attach = this.config.get<boolean>('mail.attachFiles');
    const uploadsDir = this.config.get<string>('uploads.dir')!;

    const rows: [string, string][] = [
      ['Имя', lead.name],
      ['Телефон', lead.phone],
      ['Почта', lead.email || '—'],
      ['Страница', lead.page || '—'],
      ['Дата', new Date(lead.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })],
    ];

    const filesList = lead.files.length
      ? lead.files.map((f) => `${f.originalName} (${Math.round(f.size / 1024)} КБ)`).join('\n')
      : '—';

    const text =
      rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
      `\n\nЗадача:\n${lead.task}\n\nФайлы:\n${filesList}\n\nЗаявка №${lead.id}`;

    const esc = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f2f2f3;font-family:Arial,Helvetica,sans-serif;color:#1d1f20">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f3;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid rgba(29,31,32,.16)">
  <tr><td style="background:#1d2d3d;color:#f2f2f3;padding:20px 24px">
    <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#b5d9fd">Заявка с сайта</div>
    <div style="font-size:22px;font-weight:bold;margin-top:6px">ООО НПП «Технолидер»</div>
  </td></tr>
  <tr><td style="padding:24px">
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #e7e7ea;color:#5d5d60;width:120px">${esc(k)}</td>` +
            `<td style="padding:8px 0;border-bottom:1px solid #e7e7ea">${esc(v)}</td></tr>`,
        )
        .join('')}
    </table>
    <div style="margin-top:20px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5d5d60">Задача</div>
    <div style="margin-top:8px;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(lead.task)}</div>
    ${
      lead.files.length
        ? `<div style="margin-top:20px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5d5d60">Файлы</div>
           <div style="margin-top:8px;font-size:14px;line-height:1.6">${lead.files
             .map((f) => `${esc(f.originalName)} — ${Math.round(f.size / 1024)} КБ`)
             .join('<br>')}</div>`
        : ''
    }
  </td></tr>
  <tr><td style="padding:14px 24px;border-top:1px solid #e7e7ea;font-size:12px;color:#7a7a7d">
    Заявка №${esc(lead.id)} · ${esc(lead.ip || '')}
  </td></tr>
</table></td></tr></table></body></html>`;

    await this.transporter.sendMail({
      from: this.config.get<string>('mail.from'),
      to,
      replyTo: lead.email || undefined,
      subject: `Заявка с сайта — ${lead.name}, ${lead.phone}`,
      text,
      html,
      attachments:
        attach && lead.files.length
          ? lead.files.map((f) => ({
              filename: f.originalName,
              path: path.join(uploadsDir, f.storedName),
            }))
          : undefined,
    });

    this.logger.log(`Заявка №${lead.id} отправлена на ${to.join(', ')}`);
  }
}
