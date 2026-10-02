import { Injectable } from '@nestjs/common';
import { Network } from '@exchange/db';
import { PrismaService } from '../prisma/prisma.service';
import { deriveDepositWallet, isValidOnchainAddress } from './hd';

@Injectable()
export class WalletsService {
  constructor(private prisma: PrismaService) {}

  async ensureUserWallets(userId: string) {
    const networks: Network[] = ['TON', 'TRC20'];
    const result = [];
    for (const network of networks) {
      const existing = await this.prisma.walletAddress.findUnique({
        where: { userId_network: { userId, network } },
      });
      if (existing) {
        // Keep existing even if placeholder — admin regenerates explicitly
        result.push(existing);
        continue;
      }
      const count = await this.prisma.walletAddress.count({ where: { network } });
      const derived = deriveDepositWallet(network, count + 1);
      const created = await this.prisma.walletAddress.create({
        data: {
          userId,
          network,
          address: derived.address,
          derivationIdx: derived.derivationIdx,
          privateKeyEnc: derived.privateKeyEnc,
        },
      });
      result.push(created);
    }
    return result;
  }

  async getMyWallets(userId: string) {
    const wallets = await this.ensureUserWallets(userId);
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    return {
      wallets: wallets.map((w) => ({
        id: w.id,
        network: w.network,
        address: w.address,
        asset: 'USDT',
        isValid: isValidOnchainAddress(w.network, w.address),
      })),
      minDepositUsdt: settings?.minDepositUsdt ?? 1,
      note: 'Отправьте USDT на свой адрес. Зачисление — автоматически после подтверждения сети.',
    };
  }
}
