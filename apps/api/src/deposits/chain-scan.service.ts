import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepositsService } from './deposits.service';
import { scanTon, scanTrc20 } from './chain-scan';
import { isValidOnchainAddress } from '../wallets/hd';

const HOT_WINDOW_MS = 20 * 60_000; // клиент недавно открывал приложение → проверяем часто
const HOT_EVERY_MS = 25_000;
const COLD_EVERY_MS = 3 * 60_000;
const CYCLE_MS = 25_000;

export type CheckSummary = {
  checked: number;
  credited: Array<{ network: string; amountUsdt: number; txHash: string }>;
  errors: string[];
};

/**
 * Автозачисление on-chain USDT (TRC20 и TON).
 * Работает внутри API — отдельный worker/Redis не нужен.
 */
@Injectable()
export class ChainScanService implements OnModuleInit {
  private readonly logger = new Logger(ChainScanService.name);
  private running = false;
  private lastErrorLog = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private deposits: DepositsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_CHAIN_SCAN === 'true') {
      this.logger.warn('Chain scan disabled (DISABLE_CHAIN_SCAN=true)');
      return;
    }
    setTimeout(() => void this.cycle(), 8_000).unref?.();
    setInterval(() => void this.cycle(), CYCLE_MS).unref?.();
    this.logger.log('Chain scanner started (TRC20 + TON USDT)');
  }

  private logError(key: string, msg: string) {
    const now = Date.now();
    if ((this.lastErrorLog.get(key) || 0) + 5 * 60_000 > now) return;
    this.lastErrorLog.set(key, now);
    this.logger.warn(msg);
  }

  private async pace(network: string) {
    const ms = network === 'TON' && !process.env.TON_API_KEY && !process.env.TONCENTER_API_KEY ? 1_150 : 250;
    await new Promise((r) => setTimeout(r, ms));
  }

  async cycle() {
    if (this.running) return;
    this.running = true;
    try {
      const wallets = await this.prisma.walletAddress.findMany({
        include: { user: { select: { lastSeenAt: true, status: true } } },
        take: 5000,
      });
      const now = Date.now();
      const due = wallets
        .filter((w) => w.user.status !== 'banned')
        .filter((w) => isValidOnchainAddress(w.network, w.address))
        .map((w) => {
          const hot = !!w.user.lastSeenAt && now - w.user.lastSeenAt.getTime() < HOT_WINDOW_MS;
          const last = w.lastScannedAt?.getTime() ?? 0;
          return { w, hot, overdue: now - last - (hot ? HOT_EVERY_MS : COLD_EVERY_MS) };
        })
        .filter((x) => x.overdue >= 0)
        .sort((a, b) => Number(b.hot) - Number(a.hot) || b.overdue - a.overdue)
        .slice(0, 30);

      for (const { w } of due) {
        await this.scanWallet(w.id).catch((e) =>
          this.logError(`w:${w.id}`, `scan ${w.network} ${w.address}: ${e?.message || e}`),
        );
        await this.pace(w.network);
      }
    } finally {
      this.running = false;
    }
  }

  /** Проверить один адрес и зачислить всё новое */
  async scanWallet(walletId: string) {
    const w = await this.prisma.walletAddress.findUniqueOrThrow({ where: { id: walletId } });
    const res = w.network === 'TRC20' ? await scanTrc20(w.address) : await scanTon(w.address);
    if (!res.ok) {
      this.logError(`net:${w.network}`, `${w.network} scan failed: ${res.error}`);
      return { credited: [] as CheckSummary['credited'], error: res.error };
    }

    const credited: CheckSummary['credited'] = [];
    for (const t of res.transfers) {
      const known = await this.prisma.deposit.findUnique({ where: { txHash: t.txHash } });
      if (known) continue;
      try {
        await this.deposits.creditOnchain({
          address: w.address,
          network: w.network,
          txHash: t.txHash,
          amountMicros: t.amountMicros,
          ignoreMin: true,
        });
        credited.push({ network: w.network, amountUsdt: t.amountMicros / 1e6, txHash: t.txHash });
        this.logger.log(`credited ${t.amountMicros / 1e6} USDT ${w.network} → ${w.address} (${t.txHash})`);
      } catch (e: any) {
        this.logError(`c:${t.txHash}`, `credit ${t.txHash} failed: ${e?.message || e}`);
      }
    }
    await this.prisma.walletAddress.update({ where: { id: w.id }, data: { lastScannedAt: new Date() } });
    return { credited, error: null as string | null };
  }

  /** «Проверить пополнение» из Mini App: сразу сканируем оба адреса пользователя */
  async checkUser(userId: string): Promise<CheckSummary> {
    const wallets = await this.prisma.walletAddress.findMany({ where: { userId } });
    const summary: CheckSummary = { checked: 0, credited: [], errors: [] };
    for (const w of wallets) {
      const r = await this.scanWallet(w.id).catch((e) => ({ credited: [], error: String(e?.message || e) }));
      summary.checked++;
      summary.credited.push(...r.credited);
      if (r.error) summary.errors.push(`${w.network}: ${r.error}`);
    }
    return summary;
  }
}
