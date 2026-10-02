import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SweepService } from './sweep.service';
import { ExchangeModule } from '../exchange/exchange.module';
import { SettingsModule } from '../settings/settings.module';
import { DepositsModule } from '../deposits/deposits.module';
import { LedgerModule } from '../ledger/ledger.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [ExchangeModule, SettingsModule, DepositsModule, LedgerModule, JobsModule],
  controllers: [AdminController],
  providers: [AdminService, SweepService],
  exports: [SweepService],
})
export class AdminModule {}
