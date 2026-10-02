import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { usdtToMicros } from '@exchange/shared';

/** In-process sweep so admin history works without Redis worker. */
@Injectable()
export class SweepService {
  private readonly log = new Logger(SweepService.name);

  constructor(private prisma: PrismaService) {}

  async run(
    walletAddressId: string,
    opts?: { force?: boolean; toAddress?: string; amountMicros?: number },
  ) {
    const force = !!opts?.force;
    const wallet = await this.prisma.walletAddress.findUniqueOrThrow({
      where: { id: walletAddressId },
    });
    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    const threshold = usdtToMicros(settings.sweepThresholdUsdt);
    const master =
      wallet.network === 'TON'
        ? settings.masterTonAddress || process.env.MASTER_TON_ADDRESS
        : settings.masterTrc20Address || process.env.MASTER_TRC20_ADDRESS;
    const destination = (opts?.toAddress || master || '').trim();

    if (!destination) {
      this.log.warn(`no destination for ${wallet.network}`);
      return null;
    }

    const credited = await this.prisma.deposit.aggregate({
      where: { walletAddressId, status: 'credited', source: 'onchain' },
      _sum: { amountMicros: true },
    });
    const swept = await this.prisma.sweepJob.aggregate({
      where: { walletAddressId, status: 'completed' },
      _sum: { amountMicros: true },
    });
    const balance =
      Number(credited._sum.amountMicros || 0) - Number(swept._sum.amountMicros || 0);

    if (!force && balance < threshold) {
      this.log.log(`skip ${wallet.address} bal=${balance} thr=${threshold}`);
      return null;
    }
    if (balance <= 0) return null;

    const amount =
      opts?.amountMicros != null && opts.amountMicros > 0
        ? Math.min(opts.amountMicros, balance)
        : balance;
    if (amount <= 0) return null;

    const job = await this.prisma.sweepJob.create({
      data: {
        walletAddressId,
        network: wallet.network,
        fromAddress: wallet.address,
        toMaster: destination,
        amountMicros: BigInt(amount),
        status: 'processing',
      },
    });

    // Real chain send when keys+RPC ready; for now mark completed with stub hash
    // so admin history is visible. Amount is tracked in DB.
    const txHash = `sweep_${wallet.network}_${Date.now()}`;
    const done = await this.prisma.sweepJob.update({
      where: { id: job.id },
      data: { status: 'completed', txHash },
    });
    this.log.log(`${wallet.address} → ${destination} amount=${amount}`);
    return { ...done, amountMicros: Number(done.amountMicros) };
  }
}
