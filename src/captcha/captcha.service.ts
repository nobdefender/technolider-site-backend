import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Проверка токена Yandex SmartCaptcha.
 * Если секретный ключ не задан (SMARTCAPTCHA_SECRET пуст) — проверка пропускается,
 * чтобы форма работала на тестовом стенде.
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return !!this.config.get<string>('captcha.secret');
  }

  async verify(token: string | undefined, ip?: string): Promise<boolean> {
    if (!this.enabled) return true;
    if (!token) return false;

    const secret = this.config.get<string>('captcha.secret')!;
    const url = this.config.get<string>('captcha.url')!;
    const params = new URLSearchParams({ secret, token });
    if (ip) params.set('ip', ip);

    try {
      const res = await fetch(`${url}?${params.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(`SmartCaptcha ответила ${res.status} — пропускаем заявку`);
        return true; // сервис капчи недоступен: не теряем заявку
      }
      const data = (await res.json()) as { status?: string; message?: string };
      const ok = data.status === 'ok';
      if (!ok) this.logger.warn(`Капча не пройдена: ${data.status} ${data.message || ''}`);
      return ok;
    } catch (e) {
      this.logger.warn('SmartCaptcha недоступна: ' + (e as Error).message);
      return true;
    }
  }
}
