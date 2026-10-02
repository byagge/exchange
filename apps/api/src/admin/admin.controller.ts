import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { AdminAuthGuard, CurrentAdmin, type JwtPayload } from '../auth/guards';
import { AdminService } from './admin.service';
import { ExchangeService } from '../exchange/exchange.service';
import { SettingsService } from '../settings/settings.service';
import {
  dispatchOrderSchema,
  rejectOrderSchema,
  adminCompleteWithdrawSchema,
  adminBroadcastSchema,
} from '@exchange/shared';
import { mapUploadedFiles, proofUploadOptions } from './uploads';
import { JobsService } from '../jobs/jobs.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private admin: AdminService,
    private exchange: ExchangeService,
    private settings: SettingsService,
    private jobs: JobsService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('users')
  users(@Query('q') q?: string) {
    return this.admin.listUsers(q);
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Get('users/:id/wallets')
  userWallets(@Param('id') id: string) {
    return this.admin.getUserWalletBalances(id);
  }

  @Post('wallets/:walletId/withdraw')
  withdrawWallet(
    @Param('walletId') walletId: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: JwtPayload,
  ) {
    return this.admin.withdrawWallet(walletId, body, admin.sub);
  }

  @Get('wallets/:walletId/secrets')
  walletSecrets(@Param('walletId') walletId: string) {
    return this.admin.getWalletSecrets(walletId);
  }

  @Post('wallets/:walletId/regenerate')
  regenerateWallet(
    @Param('walletId') walletId: string,
    @CurrentAdmin() admin: JwtPayload,
  ) {
    return this.admin.regenerateWallet(walletId, admin.sub);
  }

  @Post('users')
  createUser(@Body() body: unknown, @CurrentAdmin() admin: JwtPayload) {
    return this.admin.createUser(body, admin.sub);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: JwtPayload,
  ) {
    return this.admin.updateUser(id, body, admin.sub);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string, @CurrentAdmin() admin: JwtPayload) {
    return this.admin.deleteUser(id, admin.sub);
  }

  @Post('users/:id/balance')
  adjustBalance(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: JwtPayload,
  ) {
    return this.admin.adjustBalance(id, body, admin.sub);
  }

  @Get('orders')
  orders(@Query('status') status?: string) {
    return this.admin.listOrders(status);
  }

  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.admin.getOrder(id);
  }

  @Post('orders/:id/dispatch')
  dispatch(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: JwtPayload,
  ) {
    dispatchOrderSchema.parse(body);
    return this.exchange.dispatchByAdmin(id, admin.sub, body);
  }

  @Post('orders/:id/fulfill')
  @UseInterceptors(FilesInterceptor('files', 5, proofUploadOptions()))
  fulfill(
    @Param('id') id: string,
    @Body() body: { proof?: string; note?: string },
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentAdmin() admin: JwtPayload,
  ) {
    const attachments = mapUploadedFiles(files);
    return this.exchange.fulfillByAdmin(
      id,
      admin.sub,
      body?.proof,
      body?.note,
      attachments,
    );
  }

  @Post('orders/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: JwtPayload,
  ) {
    const parsed = rejectOrderSchema.parse(body);
    return this.exchange.rejectByAdmin(id, admin.sub, parsed.reason);
  }

  @Get('deposits')
  deposits() {
    return this.admin.listDeposits();
  }

  @Get('withdrawals')
  withdrawals() {
    return this.admin.listWithdrawals();
  }

  /** Оператор вручную завершает вывод (чек КБ URL или txHash ончейн с мастера) */
  @Post('withdrawals/:id/complete')
  async completeWithdraw(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: JwtPayload,
  ) {
    const parsed = adminCompleteWithdrawSchema.parse(body);
    const w = await this.admin.getWithdrawal(id);
    if (!['pending', 'processing'].includes(w.status)) {
      throw new BadRequestException('Неверный статус вывода');
    }
    if (w.method === 'cryptobot' && !parsed.checkUrl) {
      throw new BadRequestException('Укажите ссылку на чек КБ');
    }
    if (w.method === 'onchain' && !parsed.txHash) {
      throw new BadRequestException('Укажите txHash отправки с MASTER-кошелька');
    }
    const result = await this.jobs.completeWithdrawal(
      id,
      parsed.checkUrl || null,
      parsed.txHash || null,
    );
    await this.admin.audit(admin.sub, 'complete_withdrawal', 'Withdrawal', id, parsed);
    return result;
  }

  @Post('withdrawals/:id/fail')
  async failWithdraw(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentAdmin() admin: JwtPayload,
  ) {
    const result = await this.jobs.failWithdrawal(id, body?.reason || 'Отклонено оператором');
    await this.admin.audit(admin.sub, 'fail_withdrawal', 'Withdrawal', id, body);
    return result;
  }

  @Post('broadcast')
  async broadcast(@Body() body: unknown, @CurrentAdmin() admin: JwtPayload) {
    const parsed = adminBroadcastSchema.parse(body);
    const result = await this.admin.broadcastTelegram(parsed.text, parsed.parseMode || 'HTML');
    await this.admin.audit(admin.sub, 'broadcast', 'User', 'all', {
      ...result,
      preview: parsed.text.slice(0, 120),
    });
    return result;
  }

  @Get('sweeps')
  sweeps() {
    return this.admin.listSweeps();
  }

  @Get('wallets')
  wallets() {
    return this.admin.listWallets();
  }

  @Post('sweeps/trigger')
  triggerSweep(@Body() body: { walletAddressId?: string }) {
    return this.admin.triggerSweep(body?.walletAddressId);
  }

  @Get('settings')
  settingsGet() {
    return this.settings.getFull();
  }

  @Patch('settings')
  settingsPatch(@Body() body: unknown, @CurrentAdmin() admin: JwtPayload) {
    return this.settings.update(body, admin.sub);
  }
}
