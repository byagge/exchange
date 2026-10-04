import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '@exchange/db';
import { usdtToMicros } from '@exchange/shared';
import { spawn } from 'child_process';
import path from 'path';
import { pollAllDepositWallets } from './chain';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

const QUEUES = {
  deposits: 'deposits',
  payouts: 'payouts',
  sweeps: 'sweeps',
  cryptobot: 'cryptobot',
  notify: 'notify',
};

async function creditViaApi(depositId: string, amountMicros: number) {
  const api = process.env.API_URL || 'http://localhost:3001';
  // Direct DB credit path used by worker to avoid circular auth
  const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
  if (deposit.status === 'credited') return;

  await prisma.$transaction(async (tx) => {
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
        reason: 'deposit_cryptobot',
        referenceType: 'deposit',
        referenceId: depositId,
      },
    });
  });

  console.log(`[cryptobot] credited deposit ${depositId} amount=${amountMicros}`);
  void api;
}

function runKbActivate(checkUrl: string): Promise<{ ok: boolean; amount?: number; error?: string }> {
  return new Promise((resolve) => {
    const script = path.join(__dirname, '../kb_session/activate_check.py');
    const py = spawn('python', [script, checkUrl], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => (out += d.toString()));
    py.stderr.on('data', (d) => (err += d.toString()));
    py.on('close', (code) => {
      if (code !== 0) {
        if (
          process.env.ALLOW_MOCK_PAYOUTS === 'true' &&
          !process.env.CRYPTOBOT_SESSION
        ) {
          console.warn('[cryptobot] ALLOW_MOCK_PAYOUTS — mock activate +10');
          resolve({ ok: true, amount: 10 });
          return;
        }
        resolve({ ok: false, error: err || `exit ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(out.trim().split('\n').pop() || '{}');
        resolve(parsed);
      } catch {
        resolve({ ok: false, error: 'invalid python output' });
      }
    });
  });
}

async function completeWithdrawal(withdrawalId: string, checkUrl: string) {
  const w = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  if (w.status === 'completed') return;
  const total = w.amountMicros + w.feeMicros;

  await prisma.$transaction(async (tx) => {
    const locked = await tx.ledgerAccount.findUniqueOrThrow({
      where: { userId_kind: { userId: w.userId, kind: 'locked' } },
    });
    if (locked.balance < total) throw new Error('locked balance too low');
    const balanceAfter = locked.balance - total;
    await tx.ledgerAccount.update({
      where: { id: locked.id },
      data: { balance: balanceAfter },
    });
    await tx.ledgerEntry.create({
      data: {
        accountId: locked.id,
        amount: -total,
        balanceAfter,
        reason: 'withdraw_complete',
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
      },
    });
    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'completed', checkUrl, completedAt: new Date() },
    });
    if (w.orderId) {
      await tx.exchangeOrder.update({
        where: { id: w.orderId },
        data: { status: 'completed', completedAt: new Date(), proof: checkUrl },
      });
      await tx.user.update({
        where: { id: w.userId },
        data: {
          loyaltyVolume: { increment: w.amountMicros },
          tradeCount: { increment: 1 },
        },
      });
    }
  });
}

async function maybeSweep(
  walletAddressId: string,
  force = false,
  opts?: { toAddress?: string; amountMicros?: number },
) {
  const wallet = await prisma.walletAddress.findUniqueOrThrow({ where: { id: walletAddressId } });
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const threshold = usdtToMicros(settings.sweepThresholdUsdt);
  const master =
    wallet.network === 'TON' ? settings.masterTonAddress : settings.masterTrc20Address;
  const destination = (opts?.toAddress || master || '').trim();

  if (!destination) {
    console.warn(`[sweep] destination for ${wallet.network} not configured`);
    return;
  }

  // Simulated on-chain balance: sum credited deposits not yet swept
  const credited = await prisma.deposit.aggregate({
    where: {
      walletAddressId,
      status: 'credited',
      source: 'onchain',
    },
    _sum: { amountMicros: true },
  });
  const swept = await prisma.sweepJob.aggregate({
    where: { walletAddressId, status: 'completed' },
    _sum: { amountMicros: true },
  });
  const balance =
    Number(credited._sum.amountMicros || 0) - Number(swept._sum.amountMicros || 0);

  if (!force && balance < threshold) {
    console.log(`[sweep] skip ${wallet.address} balance=${balance} threshold=${threshold}`);
    return;
  }
  if (balance <= 0) return;

  const amount =
    opts?.amountMicros != null && opts.amountMicros > 0
      ? Math.min(opts.amountMicros, balance)
      : balance;
  if (amount <= 0) return;

  const job = await prisma.sweepJob.create({
    data: {
      walletAddressId,
      network: wallet.network,
      fromAddress: wallet.address,
      toMaster: destination,
      amountMicros: BigInt(amount),
      status: 'processing',
    },
  });

  // Placeholder: real chain send happens when HD keys + RPC configured
  const txHash = `sweep_${wallet.network}_${Date.now()}`;
  await prisma.sweepJob.update({
    where: { id: job.id },
    data: { status: 'completed', txHash },
  });
  console.log(`[sweep] ${wallet.address} to ${destination} amount=${amount} tx=${txHash}`);
}

async function start() {
  try {
    await connection.connect();
  } catch (e: any) {
    console.warn('Redis not available — worker idle:', e.message);
    setInterval(() => {}, 1 << 30);
    return;
  }

  // Chain deposit scanner
  new Worker(
    QUEUES.deposits,
    async (job) => {
      if (job.name === 'poll_chains') {
        await pollAllDepositWallets();
        return;
      }
      console.log('[deposits]', job.name, job.data);
    },
    { connection },
  );

  new Worker(
    QUEUES.cryptobot,
    async (job) => {
      if (job.name !== 'activate_check') return;
      const { depositId, checkUrl } = job.data as { depositId: string; checkUrl: string };
      await prisma.deposit.update({
        where: { id: depositId },
        data: { status: 'confirming' },
      });
      const result = await runKbActivate(checkUrl);
      if (!result.ok) {
        await prisma.deposit.update({
          where: { id: depositId },
          data: { status: 'failed', error: result.error || 'activate failed' },
        });
        throw new Error(result.error || 'activate failed');
      }
      const amt = Number(result.amount ?? 0);
      if (!(amt > 0)) {
        await prisma.deposit.update({
          where: { id: depositId },
          data: { status: 'failed', error: 'amount not parsed from CryptoBot' },
        });
        throw new Error('amount not parsed');
      }
      const amountMicros = usdtToMicros(amt);
      await creditViaApi(depositId, amountMicros);
    },
    { connection },
  );

  new Worker(
    QUEUES.payouts,
    async (job) => {
      const { withdrawalId } = job.data as { withdrawalId: string };
      const w = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'processing' },
      });

      if (job.name === 'cryptobot_payout') {
        if (process.env.ALLOW_MOCK_PAYOUTS === 'true') {
          const checkUrl = `https://t.me/send?start=CQ_OUT_${withdrawalId.slice(-8)}`;
          await completeWithdrawal(withdrawalId, checkUrl);
          console.log(`[payout:MOCK] cryptobot → ${w.destination} ${checkUrl}`);
          return;
        }
        // Real create via python; leave processing for operator if fails
        const script = path.join(__dirname, '../kb_session/create_check.py');
        const amount = Number(w.amountMicros) / 1e6;
        const result = await new Promise<{ ok: boolean; checkUrl?: string; error?: string }>(
          (resolve) => {
            const py = spawn('python', [script, String(amount), w.destination], {
              env: { ...process.env },
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            let out = '';
            let err = '';
            py.stdout.on('data', (d) => (out += d.toString()));
            py.stderr.on('data', (d) => (err += d.toString()));
            py.on('close', (code) => {
              if (code !== 0) {
                resolve({ ok: false, error: err || `exit ${code}` });
                return;
              }
              try {
                resolve(JSON.parse(out.trim().split('\n').pop() || '{}'));
              } catch {
                resolve({ ok: false, error: 'bad python output' });
              }
            });
          },
        );
        if (result.ok && result.checkUrl) {
          await completeWithdrawal(withdrawalId, result.checkUrl);
          console.log(`[payout] cryptobot → ${w.destination} ${result.checkUrl}`);
        } else {
          await prisma.withdrawal.update({
            where: { id: withdrawalId },
            data: { error: result.error || 'create_check failed — manual required' },
          });
          console.warn('[payout] cryptobot needs manual:', result.error);
        }
        return;
      }

      if (job.name === 'onchain_payout') {
        // Funds source: MASTER hot-wallet (after sweeps from deposit addresses)
        if (process.env.ALLOW_MOCK_PAYOUTS === 'true') {
          const txHash = `out_${w.network}_${Date.now()}`;
          await completeWithdrawal(withdrawalId, txHash);
          await prisma.withdrawal.update({
            where: { id: withdrawalId },
            data: { txHash },
          });
          console.log(`[payout:MOCK] onchain MASTER → ${w.destination} ${txHash}`);
          return;
        }
        await prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: {
            error:
              'Ончейн: отправьте с MASTER вручную и завершите в админке (или ALLOW_MOCK_PAYOUTS=true)',
          },
        });
        console.warn(`[payout] onchain awaiting operator → ${w.destination}`);
      }
    },
    { connection },
  );

  new Worker(
    QUEUES.sweeps,
    async (job) => {
      const { walletAddressId, force, toAddress, amountMicros } = job.data as {
        walletAddressId: string;
        force?: boolean;
        toAddress?: string;
        amountMicros?: number;
      };
      await maybeSweep(walletAddressId, !!force, { toAddress, amountMicros });
    },
    { connection },
  );

  new Worker(
    QUEUES.notify,
    async (job) => {
      console.log('[notify]', job.name, JSON.stringify(job.data));
      if (!process.env.BOT_TOKEN) return;

      async function send(chatId: string | bigint | number, text: string) {
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId.toString(),
            text,
            parse_mode: 'HTML',
          }),
        }).catch(() => undefined);
      }

      if (job.name === 'deposit_credited') {
        const { userId, amountMicros } = job.data as { userId: string; amountMicros: number };
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return;
        const usdt = (amountMicros / 1_000_000).toFixed(2);
        await send(user.telegramId, `✅ Зачислено <b>${usdt} USDT</b> на ваш баланс Exchange.`);
      }

      if (job.name === 'payout_dispatched') {
        const { userId, amountKopecks, minutes, deadline } = job.data as {
          userId: string;
          amountKopecks: number;
          minutes: number;
          deadline: string;
        };
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return;
        const rub = (amountKopecks / 100).toLocaleString('ru-RU', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const until = new Date(deadline).toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        });
        await send(
          user.telegramId,
          `💸 Вам направлена выплата <b>${rub} ₽</b>.\nТаймер: ${minutes} мин (до ${until}).\nПосле истечения таймера можно прикрепить видео в мини-приложении.`,
        );
      }

      if (job.name === 'client_proof_uploaded') {
        const { orderId, userId } = job.data as { orderId: string; userId: string };
        const admins = (process.env.ADMIN_TELEGRAM_IDS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const text = `📎 Клиент @${user?.username || userId} прикрепил видео к заявке ${orderId}`;
        for (const id of admins) {
          await send(id, text);
        }
      }

      if (job.name === 'admin_payout_needed') {
        const { orderId, amountKopecks } = job.data as {
          orderId: string;
          amountKopecks: number;
        };
        const admins = (process.env.ADMIN_TELEGRAM_IDS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const rub = (amountKopecks / 100).toLocaleString('ru-RU', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const text = `🆕 Новая заявка на выплату ${rub} ₽\nID: ${orderId}`;
        for (const id of admins) {
          await send(id, text);
        }
      }
    },
    { connection },
  );

  // Periodic sweep check
  const sweepQueue = new Queue(QUEUES.sweeps, { connection });
  const depositsQueue = new Queue(QUEUES.deposits, { connection });

  setInterval(async () => {
    const wallets = await prisma.walletAddress.findMany({ take: 200 });
    for (const w of wallets) {
      await sweepQueue.add('maybe_sweep', { walletAddressId: w.id });
    }
  }, 60_000);

  // Сканирование депозитов TRC20/TON переехало в API (ChainScanService) — worker больше
  // не планирует poll_chains, чтобы не дублировать зачисления.
  void depositsQueue;

  console.log('Worker online');
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
