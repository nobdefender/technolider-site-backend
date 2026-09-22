import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService } from '../src/leads/leads.service';
import type { CreateLeadDto } from '../src/leads/dto/create-lead.dto';

const dto = (over: Partial<CreateLeadDto> = {}): CreateLeadDto =>
  ({
    name: 'Иван Петров',
    phone: '+7 900 000-00-00',
    email: 'ivan@example.ru',
    task: 'Нужно изготовить корпус по чертежу, 10 шт.',
    ...over,
  }) as CreateLeadDto;

const makeService = (over: {
  mailEnabled?: boolean;
  telegramEnabled?: boolean;
  mailThrows?: boolean;
  telegramThrows?: boolean;
  dbThrows?: boolean;
  captchaOk?: boolean;
} = {}) => {
  const created: unknown[] = [];
  const prisma = {
    lead: {
      create: jest.fn(async (args: { data: unknown }) => {
        if (over.dbThrows) throw new Error('БД недоступна');
        created.push(args.data);
        return { id: 'lead_1' };
      }),
      update: jest.fn(async () => ({})),
    },
  };
  const mail = {
    enabled: over.mailEnabled ?? true,
    send: jest.fn(async () => {
      if (over.mailThrows) throw new Error('SMTP отказал');
    }),
  };
  const telegram = {
    enabled: over.telegramEnabled ?? false,
    send: jest.fn(async () => {
      if (over.telegramThrows) throw new Error('Telegram отказал');
    }),
  };
  const captcha = { enabled: true, verify: jest.fn(async () => over.captchaOk ?? true) };
  const config = { get: (k: string) => (k === 'uploads.dir' ? './uploads' : undefined) } as unknown as ConfigService;

  const service = new LeadsService(
    prisma as never,
    mail as never,
    telegram as never,
    captcha as never,
    config,
  );
  return { service, prisma, mail, telegram, captcha, created };
};

describe('LeadsService', () => {
  it('принимает корректную заявку и отправляет на почту', async () => {
    const { service, mail, prisma } = makeService();
    const res = await service.create(dto(), [], { ip: '1.2.3.4' });
    expect(res).toEqual({ ok: true, id: 'lead_1' });
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(prisma.lead.create).toHaveBeenCalledTimes(1);
  });

  it('молча отбрасывает заявку из ловушки для ботов', async () => {
    const { service, mail, prisma } = makeService();
    const res = await service.create(dto({ company: 'бот' }), [], {});
    expect(res.ok).toBe(true);
    expect(mail.send).not.toHaveBeenCalled();
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('отклоняет заявку, не прошедшую капчу', async () => {
    const { service, mail } = makeService({ captchaOk: false });
    await expect(service.create(dto(), [], {})).rejects.toBeInstanceOf(BadRequestException);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('принимает заявку, если почта отказала, но Telegram доставил', async () => {
    const { service, telegram } = makeService({ mailThrows: true, telegramEnabled: true });
    const res = await service.create(dto(), [], {});
    expect(res.ok).toBe(true);
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('сохраняет заявку в БД, даже если все каналы доставки отказали', async () => {
    const { service, prisma } = makeService({ mailThrows: true, telegramEnabled: true, telegramThrows: true });
    const res = await service.create(dto(), [], {});
    expect(res.ok).toBe(true); // заявка в БД — не потеряна
    expect(prisma.lead.update).toHaveBeenCalled();
  });

  it('сообщает об ошибке, если и БД, и доставка недоступны', async () => {
    const { service } = makeService({ dbThrows: true, mailThrows: true });
    await expect(service.create(dto(), [], {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('работает без настроенных каналов: заявка сохраняется в БД', async () => {
    const { service, prisma } = makeService({ mailEnabled: false, telegramEnabled: false });
    const res = await service.create(dto(), [], {});
    expect(res.ok).toBe(true);
    expect(prisma.lead.create).toHaveBeenCalled();
  });
});
