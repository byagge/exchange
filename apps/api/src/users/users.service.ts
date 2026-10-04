import { parseAdminTelegramIds, userIsEnvAdmin } from '../common/admin-ids';
import type { TelegramUser } from '../common/telegram-auth';
import type { User } from '@exchange/db';
import { Injectable } from '@nestjs/common';
import { generateReferralCode, resolveLoyaltyTier } from '@exchange/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ClientMeta } from '../common/client-meta';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  serialize(user: User) {
    const loyalty = resolveLoyaltyTier(Number(user.loyaltyVolume));
    const envAdmin = userIsEnvAdmin(user.telegramId);
    return {
      id: user.id,
      telegramId: user.telegramId.toString(),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      photoUrl: user.photoUrl,
      status: user.status,
      referralCode: user.referralCode,
      loyaltyVolume: Number(user.loyaltyVolume),
      tradeCount: user.tradeCount,
      rubTurnover: Number(user.rubTurnover),
      withdrawFrozen: user.withdrawFrozen,
      isAdmin: !!(user as any).isAdmin || envAdmin,
      loyalty,
      createdAt: user.createdAt,
    };
  }

  async upsertFromTelegram(tg: TelegramUser, referralCode?: string) {
    const envAdmin = userIsEnvAdmin(tg.id);
    const existing = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(tg.id) },
    });
    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          username: tg.username ?? existing.username,
          firstName: tg.first_name ?? existing.firstName,
          lastName: tg.last_name ?? existing.lastName,
          languageCode: tg.language_code ?? existing.languageCode,
          photoUrl: tg.photo_url ?? existing.photoUrl,
          // Env list always grants admin; never auto-revoke here
          ...(envAdmin ? { isAdmin: true } : {}),
        },
      });
    }

    let referredById: string | undefined;
    if (referralCode) {
      const ref = await this.prisma.user.findUnique({ where: { referralCode } });
      if (ref) referredById = ref.id;
    }

    let code = generateReferralCode();
    for (let i = 0; i < 5; i++) {
      const clash = await this.prisma.user.findUnique({ where: { referralCode: code } });
      if (!clash) break;
      code = generateReferralCode();
    }

    return this.prisma.user.create({
      data: {
        telegramId: BigInt(tg.id),
        username: tg.username,
        firstName: tg.first_name,
        lastName: tg.last_name,
        languageCode: tg.language_code,
        photoUrl: tg.photo_url,
        referralCode: code,
        referredById,
        isAdmin: envAdmin,
      },
    });
  }

  /**
   * Фиксируем IP и устройство при каждом входе в Mini App.
   * Та же пара IP+устройство в течение 12 часов — одна запись (обновляем lastSeenAt).
   */
  async recordSession(userId: string, meta: ClientMeta) {
    try {
      const now = new Date();
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          lastIp: meta.ip ?? undefined,
          lastDevice: meta.device ?? undefined,
          lastSeenAt: now,
        },
      });
      const since = new Date(now.getTime() - 12 * 3600_000);
      const recent = await this.prisma.clientSession.findFirst({
        where: {
          userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          lastSeenAt: { gte: since },
        },
        orderBy: { lastSeenAt: 'desc' },
      });
      if (recent) {
        await this.prisma.clientSession.update({
          where: { id: recent.id },
          data: { lastSeenAt: now },
        });
      } else {
        await this.prisma.clientSession.create({
          data: {
            userId,
            ip: meta.ip,
            userAgent: meta.userAgent,
            device: meta.device,
            platform: meta.platform,
          },
        });
      }
    } catch {
      /* телеметрия не должна ломать вход */
    }
  }

  async getById(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  async getProfile(id: string) {
    const user = await this.getById(id);
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const referralCount = await this.prisma.user.count({ where: { referredById: id } });
    const referralBalance = await this.prisma.ledgerAccount.findUnique({
      where: { userId_kind: { userId: id, kind: 'referral' } },
    });
    const botUsername = process.env.BOT_USERNAME || 'exchange_bot';
    return {
      user: this.serialize(user),
      referral: {
        count: referralCount,
        balanceMicros: Number(referralBalance?.balance || 0),
        link: `https://t.me/${botUsername}?start=ref_${user.referralCode}`,
        percent: settings?.referralPercent ?? 0.5,
      },
      supportUrl: settings?.supportUrl || 'https://t.me/',
      adminTelegramIds: parseAdminTelegramIds(),
    };
  }
}
