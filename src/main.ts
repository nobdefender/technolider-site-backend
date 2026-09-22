import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // За nginx: доверяем X-Forwarded-For, чтобы rate limit считал реальные IP
  app.set('trust proxy', 1);

  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Admin-Key'],
    credentials: false,
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      // Ошибки валидации — в том же виде, что ждёт форма на сайте: { ok, errors: { поле: текст } }
      exceptionFactory: (errors) => {
        const out: Record<string, string> = {};
        for (const e of errors) {
          const first = e.constraints ? Object.values(e.constraints)[0] : undefined;
          if (first) out[e.property] = first;
        }
        return new BadRequestException({ ok: false, errors: out });
      },
    }),
  );

  // Swagger — служебный раздел: открывается только с админ-ключом
  // (заголовок X-Admin-Key или ?key=…). Без ключа — 404, как будто маршрута нет.
  const adminKey = config.get<string>('adminKey');
  if (adminKey) {
    const docsPath = '/api/docs';
    app.use(docsPath, (req: Request, res: Response, next: NextFunction) => {
      const got = (req.headers['x-admin-key'] as string | undefined) || (req.query?.key as string | undefined);
      if (got && got.length === adminKey.length && got === adminKey) {
        // ключ из строки запроса кладём в cookie, чтобы статика Swagger-UI тоже открылась
        if (req.query?.key) res.cookie?.('admin_key', got, { httpOnly: true, sameSite: 'strict', path: docsPath });
        return next();
      }
      const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)admin_key=([^;]+)/);
      if (cookie && decodeURIComponent(cookie[1]) === adminKey) return next();
      res.status(404).json({ statusCode: 404, message: 'Cannot GET ' + req.originalUrl, error: 'Not Found' });
    });

    const doc = new DocumentBuilder()
      .setTitle('API сайта ООО НПП «Технолидер»')
      .setDescription('Приём заявок с формы, проверка капчи, отправка на почту и в Telegram')
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', name: 'X-Admin-Key', in: 'header' }, 'admin-key')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
    logger.log('Swagger доступен по ключу: /api/docs?key=<ADMIN_KEY>');
  }

  const port = config.get<number>('port')!;
  await app.listen(port, '0.0.0.0');
  logger.log(`Бэкенд запущен: http://0.0.0.0:${port}/api`);
}

void bootstrap();
