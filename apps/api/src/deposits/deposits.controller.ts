import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DepositsService } from './deposits.service';
import { ChainScanService } from './chain-scan.service';
import { CurrentUser, JwtAuthGuard, type JwtPayload } from '../auth/guards';

@Controller('deposits')
@UseGuards(JwtAuthGuard)
export class DepositsController {
  constructor(
    private deposits: DepositsService,
    private scanner: ChainScanService,
  ) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.deposits.listMine(user.sub);
  }

  /** Принудительная проверка адресов TON/TRC20 текущего пользователя */
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('check')
  check(@CurrentUser() user: JwtPayload) {
    return this.scanner.checkUser(user.sub);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('cryptobot')
  cryptobot(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.deposits.submitCryptoBot(user.sub, body);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('simulate')
  simulate(
    @CurrentUser() user: JwtPayload,
    @Body() body: { amountUsdt?: number; network?: 'TON' | 'TRC20' },
  ) {
    return this.deposits.simulate(user.sub, body.amountUsdt ?? 10, body.network);
  }
}
