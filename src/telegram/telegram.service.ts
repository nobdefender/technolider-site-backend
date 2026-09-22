import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import { fetch as httpFetch, FormData, type Dispatcher } from 'undici';
import { moscowTime } from '../common/time';
import type { LeadNotification } from '../leads/lead-notification.interface';
import { createProxyDispatcher, maskProxy } from './telegram-transport';

/** «1,4 МБ» / «860 КБ» — как в форме на сайте. */
function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
    : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** Отправка заявок в Telegram. Если токен или чат не заданы — отправка отключена. */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  /** Прокси для запросов к Bot API: с российских адресов api.telegram.org недоступен. */
  private readonly dispatcher?: Dispatcher;

  constructor(private readonly config: ConfigService) {
    const proxy = this.config.get<string>('telegram.proxyUrl');
    if (proxy) {
      this.dispatcher = createProxyDispatcher(proxy);
      this.logger.log(`Telegram через прокси ${maskProxy(proxy)}`);
    }
  }

  get enabled(): boolean {
    return !!this.config.get<boolean>('telegram.enabled');
  }

  /** Как ходим в Telegram — для служебной диагностики. */
  get transport(): { apiBase: string; proxy: string | null } {
    const proxy = this.config.get<string>('telegram.proxyUrl') || '';
    return {
      apiBase: this.config.get<string>('telegram.apiBase')!,
      proxy: proxy ? maskProxy(proxy) : null,
    };
  }

  private api(method: string): string {
    const base = this.config.get<string>('telegram.apiBase')!;
    return `${base}/bot${this.config.get<string>('telegram.token')}/${method}`;
  }

  /** Служебная проверка связи (getMe) через настроенный транспорт. */
  async check(): Promise<{ ok: boolean; bot?: string; error?: string }> {
    if (!this.enabled) return { ok: false, error: 'Отправка в Telegram не настроена' };
    try {
      const res = await httpFetch(this.api('getMe'), {
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        result?: { username?: string };
        description?: string;
      };
      if (!res.ok || !data.ok) return { ok: false, error: data.description || `HTTP ${res.status}` };
      return { ok: true, bot: data.result?.username ? `@${data.result.username}` : undefined };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async send(lead: LeadNotification): Promise<void> {
    if (!this.enabled) throw new Error('Отправка в Telegram не настроена');

    const chats = this.config.get<string[]>('telegram.chatIds')!;
    const text = this.format(lead);

    const withFiles = !!this.config.get<boolean>('telegram.sendFiles') && lead.files.length > 0;
    // Telegram разрешает 1024 знака подписи (теги разметки не считаются)
    const fitsCaption = text.replace(/<[^>]*>/g, '').length <= 1000;

    for (const chatId of chats) {
      if (!withFiles) {
        await this.sendText(chatId, text);
        continue;
      }

      // заявка уходит одним сообщением: файлы с текстом в подписи
      const caption = fitsCaption ? text : undefined;
      if (!caption) await this.sendText(chatId, text); // длинная задача в подпись не влезла
      try {
        await this.sendFiles(chatId, lead, caption);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Файлы к заявке №${lead.id} не отправлены в Telegram: ${reason}`);
        // текст ушёл бы вместе с файлами — значит, заявку надо продублировать
        if (caption) await this.sendText(chatId, text);
      }
    }

    this.logger.log(`Заявка №${lead.id} отправлена в Telegram (${chats.length} чат(ов))`);
  }

  /**
   * Текст заявки для Telegram (HTML-разметка Bot API). Менеджер должен с одного
   * взгляда понять: кто, когда, что нужно и куда звонить.
   */
  private format(lead: LeadNotification): string {
    const esc = (v: string) => v.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
    const digits = lead.phone.replace(/\D/g, '');
    const site = this.config.get<string[]>('corsOrigins')?.[0] || '';

    const lines = [
      '🔔 <b>Новая заявка с сайта</b>',
      `🕒 ${moscowTime(lead.createdAt)}`,
      '',
      `👤 <b>${esc(lead.name)}</b>`,
      `📞 <a href="tel:+${digits}">${esc(lead.phone)}</a>`,
    ];
    // почту пишем текстом: Telegram сам делает её кликабельной, а нестандартную
    // схему mailto: Bot API может не принять и завернуть всё сообщение
    if (lead.email) lines.push(`✉️ ${esc(lead.email)}`);
    if (lead.page) {
      const page = site
        ? `<a href="${esc(site + lead.page)}">${esc(lead.page)}</a>`
        : esc(lead.page);
      lines.push(`🔗 Страница: ${page}`);
    }

    lines.push('', '📝 <b>Задача</b>', `<blockquote>${esc(lead.task)}</blockquote>`);

    if (lead.files.length) {
      lines.push('', `📎 <b>Вложения (${lead.files.length})</b>`);
      for (const f of lead.files) lines.push(`• ${esc(f.originalName)} · ${fileSize(f.size)}`);
    }

    lines.push('', `🔖 Номер заявки в базе: <code>${lead.id}</code>`);
    return lines.join('\n');
  }

  /** Служебное сообщение в те же чаты — тревога о канале доставки. */
  async sendNotice(text: string): Promise<void> {
    if (!this.enabled) throw new Error('Отправка в Telegram не настроена');
    for (const chatId of this.config.get<string[]>('telegram.chatIds')!) {
      await this.sendText(chatId, text);
    }
  }

  /** Обычное текстовое сообщение. */
  private async sendText(chatId: string, text: string): Promise<void> {
    const res = await httpFetch(this.api('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage: ${res.status} ${await res.text()}`);
  }

  /**
   * Вложения одним сообщением: один файл — sendDocument, несколько — альбом
   * sendMediaGroup. Текст заявки идёт подписью, поэтому отдельного сообщения нет.
   */
  private async sendFiles(chatId: string, lead: LeadNotification, caption?: string): Promise<void> {
    const dir = this.config.get<string>('uploads.dir')!;
    const parts: { blob: Blob; name: string }[] = [];
    for (const f of lead.files) {
      // Node 22: Blob из потока файла, без загрузки в память целиком
      const stream = createReadStream(path.join(dir, f.storedName));
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      parts.push({ blob: new Blob([Buffer.concat(chunks)], { type: f.mimeType }), name: f.originalName });
    }

    const single = parts.length === 1;
    const form = new FormData();
    form.set('chat_id', chatId);

    if (single) {
      form.set('document', parts[0].blob, parts[0].name);
      if (caption) {
        form.set('caption', caption);
        form.set('parse_mode', 'HTML');
      }
    } else {
      parts.forEach((p, i) => form.set(`file${i}`, p.blob, p.name));
      form.set(
        'media',
        JSON.stringify(
          parts.map((_, i) => ({
            type: 'document',
            media: `attach://file${i}`,
            // у альбома подпись одна — на первом файле
            ...(i === 0 && caption ? { caption, parse_mode: 'HTML' } : {}),
          })),
        ),
      );
    }

    const res = await httpFetch(this.api(single ? 'sendDocument' : 'sendMediaGroup'), {
      method: 'POST',
      body: form,
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Telegram ${single ? 'sendDocument' : 'sendMediaGroup'}: ${res.status} ${await res.text()}`);
  }
}
