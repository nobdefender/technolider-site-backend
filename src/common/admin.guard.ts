import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Доступ к служебным эндпоинтам только по админ-ключу.
 * Ключ передаётся заголовком `X-Admin-Key` или параметром `?key=`.
 * Отвечаем 404, а не 403: снаружи не видно, что такой маршрут вообще существует.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get<string>('adminKey');
    if (!expected) throw new NotFoundException(); // ключ не задан — служебные маршруты закрыты
    const req = ctx.switchToHttp().getRequest<Request>();
    const got = (req.headers['x-admin-key'] as string | undefined) || (req.query?.key as string | undefined);
    if (!got || !safeEqual(got, expected)) throw new NotFoundException();
    return true;
  }
}

/** Сравнение без утечки времени */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
