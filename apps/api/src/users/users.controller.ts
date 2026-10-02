import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser, JwtAuthGuard } from '../auth/guards';
import type { JwtPayload } from '../auth/guards';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  async me(@CurrentUser() user: JwtPayload) {
    return this.users.getProfile(user.sub);
  }
}
