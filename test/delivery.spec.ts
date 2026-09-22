import { ConfigService } from '@nestjs/config';
import { LeadStatus } from '@prisma/client';
import { DeliveryService } from '../src/delivery/delivery.service';

const HOUR = 3_600_000;

const lead = (over: Record<string, unknown> = {}) => ({
  id: 'lead_1',
  createdAt: new Date(),
  name: 'Иван Петров',
  phone: '+7 900 000-00-00',
  email: 'ivan@example.ru',
  task: 'Нужен корпус по чертежу',
  page: '/contacts',
  ip: '1.2.3.4',
  mailSentAt: new Date(),
  telegramSentAt: null,
  files: [],
  ...over,
});

const makeService = (over: {
  mailEnabled?: boolean;
  telegramEnabled?: boolean;
  telegramOk?: boolean;
  mailOk?: boolean;
  leads?: ReturnType<typeof lead>[];
  telegramThrows?: boolean;
  state?: Record<string, string>;
} = {}) => {
  const state = new Map<string, string | null>(Object.entries(over.state ?? {}));
  const updates: Record<string, unknown>[] = [];

  const prisma = {
    lead: {
      findMany: jest.fn().mockResolvedValue(over.leads ?? []),
      update: jest.fn((args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return Promise.resolve({});
      }),
      count: jest.fn().mockResolvedValue(2),
    },
    serviceState: {
      findUnique: jest.fn(({ where: { key } }: { where: { key: string } }) =>
        Promise.resolve(state.has(key) ? { key, value: state.get(key) } : null),
      ),
      upsert: jest.fn(
        ({ where: { key }, update }: { where: { key: string }; update: { value: string | null } }) => {
          state.set(key, update.value);
          return Promise.resolve({});
        },
      ),
    },
  };

  const mail = {
    enabled: over.mailEnabled ?? true,
    send: jest.fn().mockResolvedValue(undefined),
    check: jest.fn().mockResolvedValue({ ok: over.mailOk ?? true }),
    sendAlert: jest.fn().mockResolvedValue(undefined),
  };

  const telegram = {
    enabled: over.telegramEnabled ?? true,
    send: over.telegramThrows
      ? jest.fn().mockRejectedValue(new Error('прокси не отвечает'))
      : jest.fn().mockResolvedValue(undefined),
    check: jest.fn().mockResolvedValue(
      over.telegramOk ?? true ? { ok: true } : { ok: false, error: 'прокси не отвечает' },
    ),
    sendNotice: jest.fn().mockResolvedValue(undefined),
  };

  const values: Record<string, number> = {
    'delivery.retryMinutes': 10,
    'delivery.retryDays': 3,
    'delivery.alertHours': 12,
    'delivery.alertRepeatHours': 24,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;

  const service = new DeliveryService(
    prisma as never,
    mail as never,
    telegram as never,
    config,
  );
  return { service, prisma, mail, telegram, state, updates };
};

describe('Дослыка заявок', () => {
  it('досылает только тот канал, который не сработал', async () => {
    const { service, mail, telegram, updates } = makeService({ leads: [lead()] });

    const resent = await service.resendPending();

    expect(resent).toBe(1);
    expect(mail.send).not.toHaveBeenCalled(); // почта уже ушла при приёме заявки
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(updates[0].telegramSentAt).toBeInstanceOf(Date);
    expect(updates[0].status).toBe(LeadStatus.SENT);
    expect(updates[0].deliveryError).toBeNull();
  });

  it('если канал всё ещё не отвечает — заявка остаётся в очереди с текстом ошибки', async () => {
    const { service, updates } = makeService({
      leads: [lead({ mailSentAt: null })],
      mailEnabled: false,
      telegramThrows: true,
    });

    const resent = await service.resendPending();

    expect(resent).toBe(0);
    expect(updates[0].telegramSentAt).toBeNull();
    expect(updates[0].status).toBe(LeadStatus.FAILED);
    expect(updates[0].deliveryError).toContain('прокси не отвечает');
  });

  it('ничего не делает, когда каналы выключены', async () => {
    const { service, prisma } = makeService({ mailEnabled: false, telegramEnabled: false });
    expect(await service.resendPending()).toBe(0);
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });
});

describe('Тревога о канале доставки', () => {
  it('Telegram молчит дольше 12 часов — письмо на почту', async () => {
    const { service, mail, state } = makeService({
      telegramOk: false,
      state: { 'telegram:lastOk': new Date(Date.now() - 13 * HOUR).toISOString() },
    });

    await service.watchChannels();

    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    const [subject, lines] = mail.sendAlert.mock.calls[0] as [string, string[]];
    expect(subject).toContain('Telegram');
    expect(lines.join('\n')).toContain('прокси');
    expect(lines.join('\n')).toContain('Недоставленных заявок: 2');
    expect(state.get('telegram:alertedAt')).toBeTruthy();
  });

  it('молчит меньше порога — тревоги нет', async () => {
    const { service, mail } = makeService({
      telegramOk: false,
      state: { 'telegram:lastOk': new Date(Date.now() - 3 * HOUR).toISOString() },
    });

    await service.watchChannels();

    expect(mail.sendAlert).not.toHaveBeenCalled();
  });

  it('не повторяет тревогу чаще, чем раз в сутки', async () => {
    const { service, mail } = makeService({
      telegramOk: false,
      state: {
        'telegram:lastOk': new Date(Date.now() - 30 * HOUR).toISOString(),
        'telegram:alertedAt': new Date(Date.now() - 2 * HOUR).toISOString(),
      },
    });

    await service.watchChannels();

    expect(mail.sendAlert).not.toHaveBeenCalled();
  });

  it('канал вернулся — сообщаем о восстановлении и снимаем тревогу', async () => {
    const { service, mail, state } = makeService({
      state: {
        'telegram:lastOk': new Date(Date.now() - 30 * HOUR).toISOString(),
        'telegram:alertedAt': new Date(Date.now() - 20 * HOUR).toISOString(),
      },
    });

    await service.watchChannels();

    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect((mail.sendAlert.mock.calls[0] as [string, string[]])[0]).toContain('восстановлена');
    expect(state.get('telegram:alertedAt')).toBeNull();
    expect(state.get('telegram:lastOk')).toBeTruthy();
  });

  it('почта лежит — предупреждаем в Telegram', async () => {
    const { service, telegram } = makeService({
      mailOk: false,
      state: { 'mail:lastOk': new Date(Date.now() - 13 * HOUR).toISOString() },
    });

    await service.watchChannels();

    expect(telegram.sendNotice).toHaveBeenCalledTimes(1);
    expect((telegram.sendNotice.mock.calls[0] as [string])[0]).toContain('почт');
  });
});
