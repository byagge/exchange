import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { QueueModule } from '../queue/queue.module';
import { OperatorModule } from '../telegram/operator.module';

@Module({
  imports: [PrismaModule, LedgerModule, QueueModule, OperatorModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
