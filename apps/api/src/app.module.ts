import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { LedgerModule } from './ledger/ledger.module';
import { DepositsModule } from './deposits/deposits.module';
import { ExchangeModule } from './exchange/exchange.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { SettingsModule } from './settings/settings.module';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health.controller';
import { QueueModule } from './queue/queue.module';
import { JobsModule } from './jobs/jobs.module';
import { OperatorModule } from './telegram/operator.module';
import { InternalModule } from './internal/internal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    QueueModule,
    OperatorModule,
    JobsModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    LedgerModule,
    DepositsModule,
    ExchangeModule,
    WithdrawalsModule,
    SettingsModule,
    AdminModule,
    InternalModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
