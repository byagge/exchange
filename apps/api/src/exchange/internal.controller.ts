import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InternalService, type ClientMessageInput } from './internal.service';
import { internalSecret } from '../common/internal-secret';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const got = String(req.headers['x-internal-secret'] || '');
    const want = internalSecret();
    const a = Buffer.from(got);
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}

/** Только для бот-процесса на том же сервере. Наружу nginx отдаёт /api/, поэтому ещё и секрет. */
@Controller('internal')
@SkipThrottle()
@UseGuards(InternalGuard)
export class InternalController {
  constructor(private svc: InternalService) {}

  @Get('orders/:id/summary')
  summary(@Param('id') id: string, @Query('actor') actor: string) {
    return this.svc.orderSummary(id, String(actor || ''));
  }

  @Post('orders/:id/payments')
  pay(
    @Param('id') id: string,
    @Body() b: { actor: string; amountRub: number | string; minutes?: number },
  ) {
    const rub = Number(String(b.amountRub).replace(',', '.'));
    if (!Number.isFinite(rub) || rub <= 0) throw new BadRequestException('Некорректная сумма');
    return this.svc.sendPayment(id, String(b.actor), rub, b.minutes ? Number(b.minutes) : undefined);
  }

  @Post('orders/:id/complete')
  complete(@Param('id') id: string, @Body() b: { actor: string }) {
    return this.svc.complete(id, String(b.actor));
  }

  @Post('orders/:id/cancel')
  cancel(@Param('id') id: string, @Body() b: { actor: string }) {
    return this.svc.cancel(id, String(b.actor));
  }

  @Post('orders/:id/relay')
  relay(
    @Param('id') id: string,
    @Body() b: { actor: string; chatId: string; messageId: number; text?: string },
  ) {
    return this.svc.relayToClient(id, String(b.actor), {
      chatId: String(b.chatId),
      messageId: Number(b.messageId),
      text: b.text,
    });
  }

  @Post('payments/:id/confirm')
  confirm(@Param('id') id: string, @Body() b: { telegramId: string }) {
    return this.svc.paymentConfirm(id, String(b.telegramId));
  }

  @Post('payments/:id/not-received')
  notReceived(@Param('id') id: string, @Body() b: { telegramId: string }) {
    return this.svc.paymentNotReceived(id, String(b.telegramId));
  }

  @Post('client-message')
  clientMessage(@Body() b: ClientMessageInput) {
    return this.svc.clientMessage({
      telegramId: String(b.telegramId),
      chatId: String(b.chatId),
      messageId: Number(b.messageId),
      text: b.text,
      mediaType: b.mediaType,
      fileId: b.fileId,
    });
  }

  @Post('set-group')
  setGroup(@Body() b: { chatId: string; actor: string }) {
    return this.svc.setGroup(String(b.chatId), String(b.actor));
  }
}
