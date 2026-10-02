import { Controller, Get, UseGuards } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { CurrentUser, JwtAuthGuard, type JwtPayload } from '../auth/guards';

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private wallets: WalletsService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.wallets.getMyWallets(user.sub);
  }
}
