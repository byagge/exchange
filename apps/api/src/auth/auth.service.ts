import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authTelegramSchema, adminLoginSchema } from '@exchange/shared';
import * as bcrypt from 'bcryptjs';
import { validateTelegramInitData } from '../common/telegram-auth';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  async telegramLogin(body: unknown) {
    const parsed = authTelegramSchema.parse(body);
    const result = validateTelegramInitData(parsed.initData, process.env.BOT_TOKEN || '');
    if (!result.ok) throw new UnauthorizedException(result.error);

    const user = await this.users.upsertFromTelegram(result.user, parsed.referralCode);
    await this.ledger.ensureAccounts(user.id);

    const serialized = this.users.serialize(user);
    const token = await this.jwt.signAsync({
      sub: user.id,
      typ: 'user',
      telegramId: user.telegramId.toString(),
      isAdmin: !!serialized.isAdmin,
    });

    return {
      token,
      user: serialized,
    };
  }

  async adminLogin(body: unknown) {
    const parsed = adminLoginSchema.parse(body);
    const admin = await this.prisma.adminUser.findUnique({ where: { email: parsed.email } });
    if (!admin) throw new UnauthorizedException('Неверный логин или пароль');
    const ok = await bcrypt.compare(parsed.password, admin.passwordHash);
    if (!ok) throw new UnauthorizedException('Неверный логин или пароль');

    const token = await this.jwt.signAsync({
      sub: admin.id,
      typ: 'admin',
      role: admin.role,
    });

    return {
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    };
  }
}
