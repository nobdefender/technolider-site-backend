/** Конфигурация из переменных окружения (см. .env.example). */
export const configuration = () => ({
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  /** Домены фронтенда, которым разрешён доступ (CORS), через запятую */
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Ограничение частоты отправки формы */
  throttle: {
    ttlSeconds: parseInt(process.env.THROTTLE_TTL || '3600', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '5', 10),
  },

  uploads: {
    dir: process.env.UPLOADS_DIR || './uploads',
    maxFileSizeMb: parseInt(process.env.UPLOADS_MAX_FILE_MB || '5', 10),
    maxFiles: parseInt(process.env.UPLOADS_MAX_FILES || '3', 10),
  },

  captcha: {
    /** Секретный ключ Yandex SmartCaptcha; пусто — проверка отключена */
    secret: process.env.SMARTCAPTCHA_SECRET || '',
    url: process.env.SMARTCAPTCHA_URL || 'https://smartcaptcha.yandexcloud.net/validate',
  },

  mail: {
    enabled: !!process.env.SMTP_HOST,
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: (process.env.SMTP_SECURE || 'true') !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
    /** Получатели заявок, через запятую */
    to: (process.env.MAIL_TO || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    /** Прикладывать файлы к письму (иначе — только ссылки/список) */
    attachFiles: (process.env.MAIL_ATTACH_FILES || 'true') !== 'false',
  },

  telegram: {
    enabled: !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID,
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    /** Чаты через запятую (личка, группа) */
    chatIds: (process.env.TELEGRAM_CHAT_ID || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sendFiles: (process.env.TELEGRAM_SEND_FILES || 'true') !== 'false',
  },

  /** Ключ для служебных запросов (список заявок): заголовок X-Admin-Key */
  adminKey: process.env.ADMIN_KEY || '',
});

export type AppConfig = ReturnType<typeof configuration>;
