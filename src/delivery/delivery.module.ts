import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [MailModule, TelegramModule],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
