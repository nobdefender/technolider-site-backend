import { BadRequestException, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { CaptchaModule } from '../captcha/captcha.module';
import { MailModule } from '../mail/mail.module';
import { TelegramModule } from '../telegram/telegram.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/** Разрешённые MIME-типы (дополнительная проверка к расширению). */
const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // DWG, STEP и прочие CAD-форматы часто приходят так
  'text/plain',
]);

/** Расширения вложений — основной фильтр: браузер шлёт CAD-файлы как octet-stream,
 *  поэтому по одному лишь MIME-типу пропустить можно что угодно, включая .exe.
 *  Архивы (zip, rar, 7z) не принимаем: содержимое архива по расширению не проверить. */
const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp|heic|tiff?|docx?|xlsx?|dwg|dxf|step|stp|iges|igs|sldprt|sldasm|txt|csv)$/i;

@Module({
  imports: [
    MailModule,
    TelegramModule,
    CaptchaModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dir = config.get<string>('uploads.dir')!;
        mkdirSync(dir, { recursive: true });
        return {
          storage: diskStorage({
            destination: dir,
            filename: (_req, file, cb) => {
              const ext = path.extname(file.originalname).slice(0, 12);
              cb(null, `${Date.now().toString(36)}_${randomBytes(6).toString('hex')}${ext}`);
            },
          }),
          limits: {
            fileSize: config.get<number>('uploads.maxFileSizeMb')! * 1024 * 1024,
            files: config.get<number>('uploads.maxFiles')!,
          },
          fileFilter: (_req, file, cb) => {
            const extOk = ALLOWED_EXT.test(file.originalname);
            // расширение обязательно; MIME — дополнительно, для типов, которые браузер определяет точно
            const mimeOk = ALLOWED.has(file.mimetype) || file.mimetype === 'application/octet-stream';
            if (extOk && mimeOk) cb(null, true);
            else cb(new BadRequestException(`Тип файла не поддерживается: ${file.originalname}`), false);
          },
        };
      },
    }),
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
