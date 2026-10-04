import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { InternalGuard } from './internal.guard';
import { ExchangeService } from '../exchange/exchange.service';
import { OperatorService } from '../telegram/operator.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('internal')
@UseGuards(InternalGuard)
export class InternalController {
  constructor(
    private exchange: ExchangeService,
    private operator: OperatorService,
    private prisma: PrismaService,
  ) {}

  @Post('orders/:id/dispatch')
  dispatch(@Param('id') id: string, @Body() body: { amountRub?: number; timerMinutes?: number; note?: string }) {
    return this.exchange.dispatchByAdmin(id, 'bot-operator', {
      amountRub: body.amountRub,
      timerMinutes: body.timerMinutes,
      note: body.note,
    });
  }

  @Post('orders/:id/fulfill')
  fulfill(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.exchange.fulfillByAdmin(id, 'bot-operator', undefined, body.note);
  }

  @Post('orders/:id/reject')
  reject(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.exchange.rejectByAdmin(id, 'bot-operator', body.reason || 'Отменено оператором');
  }

  @Post('orders/:id/extra-payout')
  async extra(@Param('id') id: string, @Body() body: { amountRub: number; note?: string }) {
    await this.operator.notifyClientExtraPayout(id, Number(body.amountRub), body.note);
    return { ok: true };
  }

  @Post('orders/:id/payout-confirm')
  async confirm(
    @Param('id') id: string,
    @Body() body: { status: 'arrived' | 'not_arrived' },
  ) {
    const order = await this.prisma.exchangeOrder.update({
      where: { id },
      data: {
        payoutConfirm: body.status,
        awaitingClientVideo: body.status === 'not_arrived',
      },
    });
    if (body.status === 'arrived') {
      await this.operator.postToOrderTopic(
        id,
        `✅ Клиент подтвердил: <b>средства пришли</b>`,
      );
      await this.operator.updateTopicTitle(id, '🟢');
    } else {
      await this.operator.postToOrderTopic(
        id,
        `❌ Клиент сообщил: <b>средства не пришли</b>. Ожидаем видео.`,
      );
      await this.operator.updateTopicTitle(id, '🟠');
    }
    return order;
  }

  @Get('orders/by-topic/:chatId/:topicId')
  async byTopic(@Param('chatId') chatId: string, @Param('topicId') topicId: string) {
    return this.prisma.exchangeOrder.findFirst({
      where: {
        adminForumChatId: chatId,
        adminTopicId: Number(topicId),
      },
      include: { user: true },
    });
  }

  @Get('orders/:id')
  async one(@Param('id') id: string) {
    return this.prisma.exchangeOrder.findUnique({
      where: { id },
      include: { user: true },
    });
  }

  @Post('forum/bind')
  bind(@Body() body: { chatId: string }) {
    return this.operator.bindForumChat(String(body.chatId));
  }

  @Get('forum/status')
  async forumStatus() {
    const forumChatId = await this.operator.resolveForumChatId();
    return { forumChatId, ok: !!forumChatId };
  }
}
