import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { extractClientMeta } from '../common/client-meta';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('telegram')
  telegram(@Body() body: unknown, @Req() req: Request) {
    return this.auth.telegramLogin(body, extractClientMeta(req));
  }

  @Post('admin/login')
  adminLogin(@Body() body: unknown) {
    return this.auth.adminLogin(body);
  }
}
