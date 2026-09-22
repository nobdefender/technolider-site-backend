import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Подключение к базе данных установлено');
    } catch (e) {
      // Сайт должен принимать заявки даже при недоступной БД: она нужна для истории,
      // а доставка идёт почтой и в Telegram. Поэтому не роняем приложение.
      this.logger.error('Нет соединения с базой данных: ' + (e as Error).message);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Доступна ли БД (для healthcheck) */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
