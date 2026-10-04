import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { ChainScanService } from './chain-scan.service';
import { DepositsController } from './deposits.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [LedgerModule, WalletsModule],
  providers: [DepositsService, ChainScanService],
  controllers: [DepositsController],
  exports: [DepositsService, ChainScanService],
})
export class DepositsModule {}
