import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { spawn } from 'child_process';
import path from 'path';
import { usdtToMicros } from '@exchange/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { QueueService, QUEUES } from '../queue/queue.service';

function mocksAllowed() {
  return process.env.ALLOW_MOCK_PAYOUTS === 'true';
}

function hasCryptoBotSession() {
  return !!(
    process.env.CRYPTOBOT_SESSION &&
    process.env.TELEGRAM_API_ID &&
    process.env.TELEGRAM_API_HASH
  );
}

function runPython(
  scriptRel: string,
  args: string[],
): Promise<{ ok: boolean; amount?: number; checkUrl?: string; error?: string }> {
  return new Promise((resolve) => {
    const fs = require('fs') as typeof import('fs');
    const candidates = [
      path.resolve(__dirname, '../../../../worker/kb_session', scriptRel),
      path.resolve(process.cwd(), 'apps/worker/kb_session', scriptRel),
      path.resolve(process.cwd(), '../worker/kb_session', scriptRel),
      path.resolve(process.cwd(), '../../apps/worker/kb_session', scriptRel),
      path.join('D:/codes/exchange crypto/apps/worker/kb_session', scriptRel),
    ];
    const file = candidates.find((c) => fs.existsSync(c));
    if (!file) {
      resolve({ ok: false, error: `python script not found: ${scriptRel}` });
      return;
    }

    const py = spawn('python', [file, ...args], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => (out += d.toString()));
    py.stderr.on('data', (d) => (err += d.toString()));
    py.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: err || out || `exit ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(out.trim().split('\n').pop() || '{}');
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: 'invalid python output' });
      }
    });
    py.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

/**
 * Обработчик фоновых задач.
 * Работает и через Redis (worker), и inline в API если Redis недоступен.
 */
@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private queue: QueueService,
  ) {}

  onModuleInit() {
    this.queue.registerInlineHandler(QUEUES.cryptobot, async (jobName, data) => {
      if (jobName === 'activate_check') {
        await this.activateCryptoBotDeposit(data as any);
      }
    });
    this.queue.registerInlineHandler(QUEUES.payouts, async (jobName, data) => {
      const { withdrawalId } = data as { withdrawalId: string };
      if (jobName === 'cryptobot_payout') {
        await this.processCryptoBotPayout(withdrawalId);
      } else if (jobName === 'onchain_payout') {
        await this.processOnchainPayout(withdrawalId);
      }
    });
    this.queue.registerInlineHandler(QUEUES.notify, async (jobName, data) => {
      await this.notify(jobName, data);
    });
    this.logger.log('Inline job handlers registered');
  }

  async activateCryptoBotDeposit(data: {
    depositId: string;
    checkUrl: string;
    userId?: string;
  }) {
    const { depositId, checkUrl } = data;
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    if (!deposit || deposit.status === 'credited') return;
    if (deposit.status === 'failed') return;

    await this.prisma.deposit.update({
      where: { id: depositId },
      data: { status: 'confirming' },
    });

    let amountUsdt = 0;
    let activated = false;

    if (hasCryptoBotSession()) {
      const result = await runPython('activate_check.py', [checkUrl]);
      if (result.ok) {
        activated = true;
        amountUsdt = Number(result.amount || 0);
      } else {
        await this.prisma.deposit.update({
          where: { id: depositId },
          data: { status: 'failed', error: result.error || 'activate failed' },
        });
        this.logger.warn(`CryptoBot activate failed: ${result.error}`);
        return;
      }
    } else if (mocksAllowed()) {
      this.logger.warn('[MOCK] CryptoBot deposit activate — ALLOW_MOCK_PAYOUTS');
      activated = true;
      amountUsdt = 10;
    } else {
      await this.prisma.deposit.update({
        where: { id: depositId },
        data: {
          status: 'failed',
          error:
            'CryptoBot session не настроена (TELEGRAM_API_ID/HASH + CRYPTOBOT_SESSION). Для демо: ALLOW_MOCK_PAYOUTS=true',
        },
      });
      return;
    }

    if (!activated) return;

    if (!(amountUsdt > 0)) {
      await this.prisma.deposit.update({
        where: { id: depositId },
        data: {
          status: 'failed',
          error: 'Не удалось определить сумму чека. Проверьте чек вручную.',
        },
      });
      return;
    }

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    if (settings && amountUsdt < settings.minDepositUsdt) {
      await this.prisma.deposit.update({
        where: { id: depositId },
        data: {
          status: 'failed',
          error: `Сумма чека ${amountUsdt} USDT ниже минимума ${settings.minDepositUsdt}`,
        },
      });
      return;
    }

    const amountMicros = usdtToMicros(amountUsdt);
    await this.creditDepositAtomic(depositId, amountMicros, 'deposit_cryptobot');
    await this.queue.enqueue(QUEUES.notify, 'deposit_credited', {
      userId: deposit.userId,
      amountMicros,
      depositId,
    });
  }

  private async creditDepositAtomic(
    depositId: string,
    amountMicros: number,
    reason: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUniqueOrThrow({ where: { id: depositId } });
      if (deposit.status === 'credited') return;

      await tx.deposit.update({
        where: { id: depositId },
        data: {
          status: 'credited',
          amountMicros: BigInt(amountMicros),
          creditedAt: new Date(),
        },
      });

      const account = await tx.ledgerAccount.upsert({
        where: { userId_kind: { userId: deposit.userId, kind: 'available' } },
        create: { userId: deposit.userId, kind: 'available', balance: 0n },
        update: {},
      });

      // Atomic balance bump via conditional update mindset
      const balanceAfter = account.balance + BigInt(amountMicros);
      await tx.ledgerAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
      });
      await tx.ledgerEntry.create({
        data: {
          accountId: account.id,
          amount: BigInt(amountMicros),
          balanceAfter,
          reason,
          referenceType: 'deposit',
          referenceId: depositId,
        },
      });
    });
  }

  async processCryptoBotPayout(withdrawalId: string) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!w || w.status === 'completed' || w.status === 'failed') return;

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'processing' },
    });

    const amountUsdt = Number(w.amountMicros) / 1e6;

    if (hasCryptoBotSession()) {
      const result = await runPython('create_check.py', [
        String(amountUsdt),
        w.destination,
      ]);
      if (result.ok && result.checkUrl) {
        await this.completeWithdrawal(withdrawalId, result.checkUrl, null);
        return;
      }
      this.logger.warn(`CryptoBot create_check failed: ${result.error}`);
      // leave processing — operator can finish manually
      await this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { error: result.error || 'create_check failed — нужна ручная выдача чека' },
      });
      await this.queue.enqueue(QUEUES.notify, 'admin_withdraw_manual', {
        withdrawalId,
        method: 'cryptobot',
        destination: w.destination,
        amountMicros: Number(w.amountMicros),
      });
      return;
    }

    if (mocksAllowed()) {
      const checkUrl = `https://t.me/send?start=CQ_MOCK_${withdrawalId.slice(-8)}`;
      this.logger.warn(`[MOCK] CryptoBot payout → ${w.destination}`);
      await this.completeWithdrawal(withdrawalId, checkUrl, null);
      return;
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        error:
          'Чек КБ: нет сессии CryptoBot. Оператор выдаст чек вручную. (ALLOW_MOCK_PAYOUTS=true для демо)',
      },
    });
    await this.queue.enqueue(QUEUES.notify, 'admin_withdraw_manual', {
      withdrawalId,
      method: 'cryptobot',
      destination: w.destination,
      amountMicros: Number(w.amountMicros),
    });
  }

  /**
   * Ончейн-вывод: средства уходят с MASTER hot-wallet (не с депозитного адреса юзера).
   * Депозитные адреса свипятся на мастер; выплаты — с мастера.
   */
  async processOnchainPayout(withdrawalId: string) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!w || w.status === 'completed' || w.status === 'failed') return;

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'processing' },
    });

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const master =
      w.network === 'TON'
        ? settings?.masterTonAddress || process.env.MASTER_TON_ADDRESS
        : settings?.masterTrc20Address || process.env.MASTER_TRC20_ADDRESS;

    const hasKeys =
      w.network === 'TON'
        ? !!process.env.TON_HD_MNEMONIC
        : !!process.env.TRON_HD_MNEMONIC;

    if (hasKeys && master && !String(master).includes('ReplaceMe')) {
      // Real chain send would go here (master → destination).
      // Keys present but send module not fully wired → keep processing for safety.
      await this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          error: `Ончейн: отправка с мастера ${master} → ${w.destination} ожидает модуля send. Завершите вручную или включите mock.`,
        },
      });
      await this.queue.enqueue(QUEUES.notify, 'admin_withdraw_manual', {
        withdrawalId,
        method: 'onchain',
        destination: w.destination,
        network: w.network,
        master,
        amountMicros: Number(w.amountMicros),
      });
      return;
    }

    if (mocksAllowed()) {
      const txHash = `out_${w.network || 'TRC20'}_${Date.now()}`;
      this.logger.warn(
        `[MOCK] onchain payout from MASTER → ${w.destination} (ledger burn only)`,
      );
      await this.completeWithdrawal(withdrawalId, null, txHash);
      return;
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        error:
          'Ончейн-вывод с MASTER-кошелька: нет ключей HD / адреса мастера. Оператор отправит вручную. (ALLOW_MOCK_PAYOUTS=true для демо)',
      },
    });
    await this.queue.enqueue(QUEUES.notify, 'admin_withdraw_manual', {
      withdrawalId,
      method: 'onchain',
      destination: w.destination,
      network: w.network,
      master,
      amountMicros: Number(w.amountMicros),
    });
  }

  async completeWithdrawal(
    withdrawalId: string,
    checkUrl: string | null,
    txHash: string | null,
  ) {
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    if (w.status === 'completed') return w;
    const total = Number(w.amountMicros) + Number(w.feeMicros);
    await this.ledger.burnLocked(w.userId, total, 'withdraw_complete', w.id);
    const updated = await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'completed',
        checkUrl: checkUrl || undefined,
        txHash: txHash || undefined,
        completedAt: new Date(),
        error: null,
      },
    });

    await this.queue.enqueue(QUEUES.notify, 'withdraw_completed', {
      userId: w.userId,
      withdrawalId,
      method: w.method,
      checkUrl: checkUrl || updated.checkUrl,
      txHash: txHash || updated.txHash,
      destination: w.destination,
      network: w.network,
      amountMicros: Number(w.amountMicros),
    });

    return updated;
  }

  async failWithdrawal(withdrawalId: string, error: string) {
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    if (w.status === 'completed' || w.status === 'failed') return w;
    const total = Number(w.amountMicros) + Number(w.feeMicros);
    await this.ledger.unlock(w.userId, total, 'withdraw_fail', w.id);
    return this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'failed', error },
    });
  }

  private async notify(jobName: string, data: unknown) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      this.logger.log(`[notify:${jobName}] ${JSON.stringify(data)}`);
      return;
    }

    const send = async (chatId: string | bigint | number, text: string) => {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.toString(), text, parse_mode: 'HTML' }),
      }).catch(() => undefined);
    };

    const admins = (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const d = data as Record<string, any>;

    if (jobName === 'deposit_credited') {
      const user = await this.prisma.user.findUnique({ where: { id: d.userId } });
      if (!user) return;
      const usdt = (d.amountMicros / 1e6).toFixed(2);
      await send(user.telegramId, `✅ Зачислено <b>${usdt} USDT</b> на баланс.`);
    }

    if (jobName === 'withdraw_completed') {
      const user = await this.prisma.user.findUnique({ where: { id: d.userId } });
      if (!user) return;
      const usdt = (Number(d.amountMicros) / 1e6).toLocaleString('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      });

      if (d.method === 'cryptobot' || d.checkUrl) {
        const link = d.checkUrl || '';
        await send(
          user.telegramId,
          `✅ <b>Вывод чеком CryptoBot</b>\n\n` +
            `Сумма: <b>${usdt} USDT</b>\n\n` +
            (link
              ? `Ваш чек (откройте в Telegram):\n${link}\n\nАктивируйте в @CryptoBot / @send`
              : `Чек формируется. Если ссылка не пришла — напишите в поддержку.`),
        );
        return;
      }

      if (d.method === 'onchain' || d.destination || d.txHash) {
        const addr = d.destination ? `\nАдрес: <code>${d.destination}</code>` : '';
        const net = d.network ? `\nСеть: <b>${d.network}</b>` : '';
        const tx = d.txHash ? `\nTx: <code>${d.txHash}</code>` : '';
        await send(
          user.telegramId,
          `✅ <b>Ончейн-вывод выполнен</b>\n\n` +
            `Сумма <b>${usdt} USDT</b> отправлена на адрес${addr}${net}${tx}`,
        );
        return;
      }

      await send(user.telegramId, `✅ Вывод <b>${usdt} USDT</b> выполнен.`);
    }

    if (jobName === 'admin_withdraw_manual') {
      const usdt = (d.amountMicros / 1e6).toFixed(2);
      const text = `⚠️ Ручной вывод ${usdt} USDT\n${d.method} → ${d.destination}\nID: ${d.withdrawalId}`;
      for (const id of admins) await send(id, text);
    }

    if (jobName === 'admin_payout_needed' || jobName === 'payout_dispatched') {
      this.logger.log(`[notify:${jobName}] ${JSON.stringify(data)}`);
    }

    if (jobName === 'client_proof_uploaded') {
      const text = `📎 Клиент прикрепил видео к заявке ${d.orderId}`;
      for (const id of admins) await send(id, text);
    }
  }
}
