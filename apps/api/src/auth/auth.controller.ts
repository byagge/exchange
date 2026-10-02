import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('telegram')
  telegram(@Body() body: unknown) {
    return this.auth.telegramLogin(body);
  }

  @Post('admin/login')
  adminLogin(@Body() body: unknown) {
    return this.auth.adminLogin(body);
  }
}
