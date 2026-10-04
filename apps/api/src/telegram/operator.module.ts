import { Module } from '@nestjs/common';
import { OperatorService } from './operator.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [OperatorService],
  exports: [OperatorService],
})
export class OperatorModule {}
