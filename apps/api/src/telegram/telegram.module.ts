import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { OrderTopicsService } from './order-topics.service';

@Global()
@Module({
  providers: [TelegramService, OrderTopicsService],
  exports: [TelegramService, OrderTopicsService],
})
export class TelegramModule {}
