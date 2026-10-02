import { Injectable } from '@nestjs/common';
import { adminSettingsSchema } from '@exchange/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getPublic() {
    const s = await this.prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    return {
      usdtRubRate: s.usdtRubRate,
      minDepositUsdt: s.minDepositUsdt,
      minWithdrawUsdt: s.minWithdrawUsdt,
      withdrawFeeUsdt: s.withdrawFeeUsdt,
      exchangeFeePercent: s.exchangeFeePercent,
      supportUrl: s.supportUrl,
      maintenanceMode: s.maintenanceMode,
      brand: 'Exchange',
      defaultPayoutMinutes: s.defaultPayoutMinutes,
      allowDepositSimulate: process.env.ALLOW_DEPOSIT_SIMULATE === 'true',
      allowMockPayouts: process.env.ALLOW_MOCK_PAYOUTS === 'true',
      cryptoBotConfigured: !!(
        process.env.CRYPTOBOT_SESSION &&
        process.env.TELEGRAM_API_ID &&
        process.env.TELEGRAM_API_HASH
      ),
      exchangeDirections: ['USDT_RUB'] as const,
    };
  }

  async getFull() {
    const s = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    return {
      ...s,
      masterTonAddress: s.masterTonAddress || process.env.MASTER_TON_ADDRESS || null,
      masterTrc20Address: s.masterTrc20Address || process.env.MASTER_TRC20_ADDRESS || null,
    };
  }

  async update(body: unknown, adminId: string) {
    const parsed = adminSettingsSchema.parse(body);
    const updated = await this.prisma.settings.update({
      where: { id: 1 },
      data: parsed,
    });
    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'update_settings',
        entityType: 'Settings',
        entityId: '1',
        meta: parsed,
      },
    });
    return updated;
  }
}
