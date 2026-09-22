import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../common/admin.guard';
import { CaptchaService } from '../captcha/captcha.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

@ApiTags('Служебное')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
    private readonly captcha: CaptchaService,
  ) {}

  /** Публичная проверка живости (для Docker healthcheck и мониторинга) — без подробностей. */
  @Get()
  @ApiOperation({ summary: 'Проверка живости' })
  check() {
    return { ok: true, ts: Date.now() };
  }

  /** Служебное: состояние БД и настроенных каналов. Только по админ-ключу. */
  @Get('details')
  @ApiExcludeEndpoint()
  @UseGuards(AdminGuard)
  async details() {
    return {
      ok: true,
      ts: Date.now(),
      db: await this.prisma.isHealthy(),
      mail: this.mail.enabled,
      telegram: this.telegram.enabled,
      captcha: this.captcha.enabled,
    };
  }
}
