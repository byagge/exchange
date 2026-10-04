import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { ExchangeController } from './exchange.controller';
import { PaymentsService } from './payments.service';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  providers: [ExchangeService, PaymentsService, InternalService],
  controllers: [ExchangeController, InternalController],
  exports: [ExchangeService, PaymentsService],
})
export class ExchangeModule {}
