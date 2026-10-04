import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsController } from './deposits.controller';
import { ChainPollService } from './chain-poll.service';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [LedgerModule, WalletsModule, QueueModule],
  providers: [DepositsService, ChainPollService],
  controllers: [DepositsController],
  exports: [DepositsService],
})
export class DepositsModule {}
