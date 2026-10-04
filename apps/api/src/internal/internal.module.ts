import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { ExchangeModule } from '../exchange/exchange.module';
import { OperatorModule } from '../telegram/operator.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ExchangeModule, OperatorModule, PrismaModule],
  controllers: [InternalController],
})
export class InternalModule {}
