import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { usdtToMicros } from '@exchange/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { QueueService, QUEUES } from '../queue/queue.service';

/** USDT Jetton master (TON) */
const TON_USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const TRC20_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

@Injectable()
export class ChainPollService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChainPollService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private queue: QueueService,
  ) {}

  onModuleInit() {
    const enabled = process.env.CHAIN_POLL_ENABLED !== 'false';
    if (!enabled) {
      this.logger.warn('Chain poll disabled');
      return;
    }
    // First scan after short delay, then every 45s
    setTimeout(() => void this.pollOnce(), 8_000);
    this.timer = setInterval(() => void this.pollOnce(), 45_000);
    this.logger.log('Onchain deposit poller started (45s)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async pollOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const wallets = await this.prisma.walletAddress.findMany({ take: 400 });
      for (const w of wallets) {
        const txs =
          w.network === 'TRC20'
            ? await this.scanTrc20(w.address)
            : await this.scanTon(w.address);
        for (const tx of txs) {
          await this.creditIfNew(w.id, w.userId, w.network, w.address, tx);
        }
        await this.prisma.walletAddress.update({
          where: { id: w.id },
          data: { lastScannedAt: new Date() },
        });
      }
    } catch (e: any) {
      this.logger.error(`poll error: ${e?.message || e}`);
    } finally {
      this.running = false;
    }
  }

  private async scanTrc20(address: string) {
    try {
      const key = process.env.TRONGRID_API_KEY || '';
      const headers: Record<string, string> = {};
      if (key) headers['TRON-PRO-API-KEY'] = key;
      const url =
        `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20` +
        `?limit=30&only_to=true&contract_address=${TRC20_USDT}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        this.logger.warn(`TronGrid ${res.status} for ${address}`);
        return [] as Array<{ txHash: string; amountMicros: number }>;
      }
      const json = (await res.json()) as { data?: any[] };
      return (json.data || [])
        .filter((t) => String(t.to || '').toLowerCase() === address.toLowerCase())
        .map((t) => ({
          txHash: String(t.transaction_id),
          amountMicros: usdtToMicros(
            Number(t.value) / 10 ** Number(t.token_info?.decimals || 6),
          ),
        }))
        .filter((t) => t.amountMicros > 0);
    } catch (e: any) {
      this.logger.warn(`scanTrc20: ${e?.message || e}`);
      return [];
    }
  }

  private async scanTon(address: string) {
    try {
      const key = process.env.TON_API_KEY || '';
      const headers: Record<string, string> = { accept: 'application/json' };
      if (key) headers.Authorization = `Bearer ${key}`;

      // Jetton transfer history for USDT
      const url =
        `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}` +
        `/jettons/${encodeURIComponent(TON_USDT_MASTER)}/history?limit=30`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        // Fallback: account events
        return this.scanTonEvents(address, headers);
      }
      const json = (await res.json()) as { events?: any[]; operations?: any[] };
      const ops = json.operations || [];
      const out: Array<{ txHash: string; amountMicros: number }> = [];
      for (const op of ops) {
        const type = String(op.operation_type || op.type || '');
        if (type && !/transfer|jetton/i.test(type)) continue;
        const dir = String(op.direction || '');
        const recipient = String(op.recipient?.address || op.destination?.address || '');
        const isIn =
          dir === 'in' ||
          recipient.toLowerCase().includes(address.replace(/^EQ|^UQ/, '').toLowerCase().slice(0, 10));
        if (dir === 'out') continue;
        const raw = Number(op.amount ?? op.jetton?.quantity ?? 0);
        const decimals = Number(op.jetton?.decimals ?? 6);
        const micros = usdtToMicros(raw / 10 ** decimals);
        const txHash = String(op.event_id || op.tx_hash || op.transaction_hash || '');
        if (txHash && micros > 0 && (isIn || !dir)) out.push({ txHash, amountMicros: micros });
      }
      if (out.length) return out;
      return this.scanTonEvents(address, headers);
    } catch (e: any) {
      this.logger.warn(`scanTon: ${e?.message || e}`);
      return [];
    }
  }

  private async scanTonEvents(address: string, headers: Record<string, string>) {
    try {
      const res = await fetch(
        `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/events?limit=25`,
        { headers },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { events?: any[] };
      const out: Array<{ txHash: string; amountMicros: number }> = [];
      for (const ev of json.events || []) {
        const txHash = String(ev.event_id || '');
        for (const act of ev.actions || []) {
          if (act.type !== 'JettonTransfer') continue;
          const jt = act.JettonTransfer || act.jetton_transfer || {};
          const master = String(jt.jetton?.address || jt.jetton_address || '');
          if (master && !master.includes('b113a994') && !master.includes('EQCxE6')) {
            // still accept if amount looks like USDT 6 decimals inbound
          }
          const recipient = String(jt.recipient?.address || jt.recipient || '');
          const sender = String(jt.sender?.address || jt.sender || '');
          if (sender && recipient && sender === recipient) continue;
          // credit only when we are recipient
          const amountRaw = Number(jt.amount || 0);
          if (!txHash || amountRaw <= 0) continue;
          // Heuristic: if recipient matches our account in event
          const micros = usdtToMicros(amountRaw / 1e6);
          if (micros > 0) out.push({ txHash: `${txHash}:${amountRaw}`, amountMicros: micros });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  private async creditIfNew(
    walletId: string,
    userId: string,
    network: 'TON' | 'TRC20',
    address: string,
    tx: { txHash: string; amountMicros: number },
  ) {
    if (!tx.txHash || tx.amountMicros <= 0) return;

    const existing = await this.prisma.deposit.findUnique({ where: { txHash: tx.txHash } });
    if (existing) return;

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const min = settings?.minDepositUsdt ?? 1;
    if (tx.amountMicros < usdtToMicros(min)) {
      this.logger.log(`skip dust ${tx.amountMicros} < min ${min} on ${address}`);
      return;
    }

    try {
      const deposit = await this.prisma.deposit.create({
        data: {
          userId,
          source: 'onchain',
          status: 'credited',
          network,
          walletAddressId: walletId,
          amountMicros: BigInt(tx.amountMicros),
          txHash: tx.txHash,
          creditedAt: new Date(),
        },
      });

      await this.ledger.credit(userId, 'available', tx.amountMicros, 'deposit_onchain', {
        type: 'deposit',
        id: deposit.id,
      });

      await this.queue.enqueue(QUEUES.notify, 'deposit_credited', {
        userId,
        amountMicros: tx.amountMicros,
        depositId: deposit.id,
        network,
        txHash: tx.txHash,
      });

      this.logger.log(
        `credited ${tx.amountMicros / 1e6} USDT ${network} → ${userId} tx=${tx.txHash}`,
      );
    } catch (e: any) {
      // unique txHash race
      if (String(e?.code) === 'P2002') return;
      this.logger.error(`credit failed: ${e?.message || e}`);
    }
  }
}
