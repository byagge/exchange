import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ExchangeService } from './exchange.service';
import { CurrentUser, JwtAuthGuard, type JwtPayload } from '../auth/guards';
import { clientProofUploadOptions, mapUploadedFiles } from '../admin/uploads';

@Controller('exchange')
@UseGuards(JwtAuthGuard)
export class ExchangeController {
  constructor(private exchange: ExchangeService) {}

  @Get('quote')
  quote(@Query('amount') amount?: string) {
    return this.exchange.quote(Number(amount || 0));
  }

  @Get('orders')
  orders(@CurrentUser() user: JwtPayload) {
    return this.exchange.listMine(user.sub);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('orders')
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.exchange.create(user.sub, body);
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.exchange.cancel(user.sub, id);
  }

  /** Видео после истечения таймера выплаты */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('orders/:id/client-proof')
  @UseInterceptors(FilesInterceptor('files', 3, clientProofUploadOptions()))
  clientProof(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.exchange.attachClientProof(user.sub, id, mapUploadedFiles(files));
  }
}
