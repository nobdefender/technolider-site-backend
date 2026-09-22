import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import type { LeadNotification } from '../leads/lead-notification.interface';

/** Отправка заявок в Telegram. Если токен или чат не заданы — отправка отключена. */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return !!this.config.get<boolean>('telegram.enabled');
  }

  private api(method: string): string {
    return `https://api.telegram.org/bot${this.config.get<string>('telegram.token')}/${method}`;
  }

  async send(lead: LeadNotification): Promise<void> {
    if (!this.enabled) throw new Error('Отправка в Telegram не настроена');

    const chats = this.config.get<string[]>('telegram.chatIds')!;
    const esc = (v: string) => v.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
    const phoneDigits = lead.phone.replace(/\D/g, '');

    const text =
      `<b>Заявка с сайта</b>\n\n` +
      `<b>Имя:</b> ${esc(lead.name)}\n` +
      `<b>Телефон:</b> <a href="tel:+${phoneDigits}">${esc(lead.phone)}</a>\n` +
      (lead.email ? `<b>Почта:</b> ${esc(lead.email)}\n` : '') +
      (lead.page ? `<b>Страница:</b> ${esc(lead.page)}\n` : '') +
      `\n<b>Задача:</b>\n${esc(lead.task)}\n` +
      (lead.files.length ? `\n<b>Файлы:</b> ${lead.files.length} шт.\n` : '') +
      `\n<code>№${lead.id}</code>`;

    for (const chatId of chats) {
      const res = await fetch(this.api('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Telegram sendMessage: ${res.status} ${await res.text()}`);

      if (this.config.get<boolean>('telegram.sendFiles') && lead.files.length) {
        const dir = this.config.get<string>('uploads.dir')!;
        for (const f of lead.files) {
          const form = new FormData();
          form.set('chat_id', chatId);
          form.set('caption', `${f.originalName} · заявка №${lead.id}`);
          // Node 22: Blob из потока файла, без загрузки в память целиком
          const stream = createReadStream(path.join(dir, f.storedName));
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(chunk as Buffer);
          form.set('document', new Blob([Buffer.concat(chunks)], { type: f.mimeType }), f.originalName);
          const r = await fetch(this.api('sendDocument'), { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
          if (!r.ok) this.logger.warn(`Файл ${f.originalName} не отправлен в Telegram: ${r.status}`);
        }
      }
    }

    this.logger.log(`Заявка №${lead.id} отправлена в Telegram (${chats.length} чат(ов))`);
  }
}
