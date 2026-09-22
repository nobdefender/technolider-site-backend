import { Module } from '@nestjs/common';
import { CaptchaModule } from '../captcha/captcha.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { MailModule } from '../mail/mail.module';
import { TelegramModule } from '../telegram/telegram.module';
import { HealthController } from './health.controller';

@Module({
  imports: [MailModule, TelegramModule, CaptchaModule, DeliveryModule],
  controllers: [HealthController],
})
export class HealthModule {}
