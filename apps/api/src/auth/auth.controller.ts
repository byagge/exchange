import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { readClientMeta } from '../common/client-meta';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('telegram')
  telegram(@Body() body: unknown, @Req() req: Request) {
    return this.auth.telegramLogin(body, readClientMeta(req));
  }

  @Post('admin/login')
  adminLogin(@Body() body: unknown) {
    return this.auth.adminLogin(body);
  }
}
