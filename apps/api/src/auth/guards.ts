import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { userIsEnvAdmin } from '../common/admin-ids';

export type JwtPayload = {
  sub: string;
  typ: 'user' | 'admin';
  role?: string;
  telegramId?: string;
  isAdmin?: boolean;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header = req.headers.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('No token');
    try {
      const payload = this.jwt.verify<JwtPayload>(header.slice(7));
      if (payload.typ !== 'user') throw new UnauthorizedException('Wrong token type');
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header = req.headers.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('No token');
    try {
      const payload = this.jwt.verify<JwtPayload>(header.slice(7));

      // Legacy password-admin JWT
      if (payload.typ === 'admin') {
        req.admin = payload;
        return true;
      }

      // Mini App: Telegram user marked as admin (DB flag or ADMIN_TELEGRAM_IDS)
      if (payload.typ === 'user') {
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) throw new UnauthorizedException('Нет доступа админа');
        const allowed = !!(user as any).isAdmin || userIsEnvAdmin(user.telegramId);
        if (!allowed) throw new UnauthorizedException('Нет доступа админа');
        if (!(user as any).isAdmin && userIsEnvAdmin(user.telegramId)) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { isAdmin: true },
          });
        }
        req.admin = {
          sub: user.id,
          typ: 'admin' as const,
          role: 'operator',
          telegramId: user.telegramId.toString(),
          isAdmin: true,
        };
        return true;
      }

      throw new UnauthorizedException('Wrong token type');
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid token');
    }
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as JwtPayload;
});

export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().admin as JwtPayload;
});
