import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  adminAdjustBalanceSchema,
  adminCreateUserSchema,
  adminUserUpdateSchema,
  adminWalletWithdrawSchema,
  generateReferralCode,
  usdtToMicros,
} from '@exchange/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, QUEUES } from '../queue/queue.service';
import { LedgerService } from '../ledger/ledger.service';
import { fetchOnchainUsdt } from '../wallets/onchain-balance';
import {
  deriveDepositWallet,
  isValidOnchainAddress,
  masterMnemonicHint,
  readMasterMnemonic,
  revealWalletKey,
} from '../wallets/hd';
import { SweepService } from './sweep.service';

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d = new Date()) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
    private ledger: LedgerService,
    private sweeps: SweepService,
  ) {}

  async dashboard() {
    const today = startOfDay();
    const week = startOfWeek();

    const [
      usersTotal,
      usersActive,
      usersBanned,
      usersFrozen,
      depositsCredited,
      depositsPending,
      depositsToday,
      depositSum,
      depositSumToday,
      ordersTotal,
      ordersCompleted,
      ordersAwaitingPayout,
      ordersAwaitingFunds,
      ordersFailed,
      ordersToday,
      volumeCompleted,
      rubVolume,
      withdrawalsPending,
      withdrawalsCompleted,
      withdrawalsFailed,
      sweepsPending,
      settings,
      recentOrders,
      recentDeposits,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { status: 'banned' } }),
      this.prisma.user.count({ where: { status: 'frozen' } }),
      this.prisma.deposit.count({ where: { status: 'credited' } }),
      this.prisma.deposit.count({
        where: { status: { in: ['pending', 'confirming'] } },
      }),
      this.prisma.deposit.count({
        where: { status: 'credited', createdAt: { gte: today } },
      }),
      this.prisma.deposit.aggregate({
        where: { status: 'credited' },
        _sum: { amountMicros: true },
      }),
      this.prisma.deposit.aggregate({
        where: { status: 'credited', createdAt: { gte: today } },
        _sum: { amountMicros: true },
      }),
      this.prisma.exchangeOrder.count(),
      this.prisma.exchangeOrder.count({ where: { status: 'completed' } }),
      this.prisma.exchangeOrder.count({ where: { status: 'awaiting_payout' } }),
      this.prisma.exchangeOrder.count({ where: { status: 'awaiting_funds' } }),
      this.prisma.exchangeOrder.count({
        where: { status: { in: ['failed', 'cancelled'] } },
      }),
      this.prisma.exchangeOrder.count({ where: { createdAt: { gte: today } } }),
      this.prisma.exchangeOrder.aggregate({
        where: { status: 'completed' },
        _sum: { fromAmountMicros: true, toAmountKopecks: true, feeMicros: true },
      }),
      this.prisma.exchangeOrder.aggregate({
        where: { status: 'completed', createdAt: { gte: week } },
        _sum: { fromAmountMicros: true, toAmountKopecks: true },
      }),
      this.prisma.withdrawal.count({
        where: { status: { in: ['pending', 'processing'] } },
      }),
      this.prisma.withdrawal.count({ where: { status: 'completed' } }),
      this.prisma.withdrawal.count({ where: { status: 'failed' } }),
      this.prisma.sweepJob.count({
        where: { status: { in: ['pending', 'processing'] } },
      }),
      this.prisma.settings.findUnique({ where: { id: 1 } }),
      this.prisma.exchangeOrder.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { user: { select: { username: true, firstName: true, telegramId: true } } },
      }),
      this.prisma.deposit.findMany({
        where: { status: 'credited' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { user: { select: { username: true, firstName: true } } },
      }),
    ]);

    const ledgerAvailable = await this.prisma.ledgerAccount.aggregate({
      where: { kind: 'available' },
      _sum: { balance: true },
    });
    const ledgerLocked = await this.prisma.ledgerAccount.aggregate({
      where: { kind: 'locked' },
      _sum: { balance: true },
    });
    const ledgerReferral = await this.prisma.ledgerAccount.aggregate({
      where: { kind: 'referral' },
      _sum: { balance: true },
    });

    return {
      users: {
        total: usersTotal,
        active: usersActive,
        banned: usersBanned,
        frozen: usersFrozen,
      },
      deposits: {
        credited: depositsCredited,
        pending: depositsPending,
        today: depositsToday,
        volumeMicros: Number(depositSum._sum.amountMicros || 0),
        volumeTodayMicros: Number(depositSumToday._sum.amountMicros || 0),
      },
      orders: {
        total: ordersTotal,
        completed: ordersCompleted,
        awaitingPayout: ordersAwaitingPayout,
        awaitingFunds: ordersAwaitingFunds,
        failed: ordersFailed,
        today: ordersToday,
        volumeUsdtMicros: Number(volumeCompleted._sum.fromAmountMicros || 0),
        volumeRubKopecks: Number(volumeCompleted._sum.toAmountKopecks || 0),
        feesMicros: Number(volumeCompleted._sum.feeMicros || 0),
        weekUsdtMicros: Number(rubVolume._sum.fromAmountMicros || 0),
        weekRubKopecks: Number(rubVolume._sum.toAmountKopecks || 0),
      },
      withdrawals: {
        pending: withdrawalsPending,
        completed: withdrawalsCompleted,
        failed: withdrawalsFailed,
      },
      ledger: {
        availableMicros: Number(ledgerAvailable._sum.balance || 0),
        lockedMicros: Number(ledgerLocked._sum.balance || 0),
        referralMicros: Number(ledgerReferral._sum.balance || 0),
      },
      sweepsPending,
      rate: settings?.usdtRubRate || '—',
      maintenanceMode: !!settings?.maintenanceMode,
      // legacy flat fields for older UI
      ordersPending: ordersAwaitingPayout + ordersAwaitingFunds,
      volumeUsdtMicros: Number(volumeCompleted._sum.fromAmountMicros || 0),
      recentOrders: recentOrders.map((o) => this.serializeOrder(o)),
      recentDeposits: recentDeposits.map((d) => ({
        ...d,
        amountMicros: Number(d.amountMicros),
        user: d.user
          ? { ...d.user, telegramId: undefined }
          : null,
      })),
    };
  }

  serializeOrder(o: any) {
    return {
      ...o,
      fromAmountMicros: Number(o.fromAmountMicros),
      toAmountKopecks: Number(o.toAmountKopecks),
      feeMicros: Number(o.feeMicros || 0),
      payoutAmountKopecks:
        o.payoutAmountKopecks != null ? Number(o.payoutAmountKopecks) : o.payoutAmountKopecks,
      payments: Array.isArray(o.payments)
        ? o.payments.map((p: any) => ({ ...p, amountKopecks: Number(p.amountKopecks) }))
        : undefined,
      user: o.user
        ? {
            ...o.user,
            telegramId: o.user.telegramId?.toString?.() ?? o.user.telegramId,
          }
        : undefined,
    };
  }

  async listUsers(q?: string, take = 50) {
    const where = q
      ? {
          OR: [
            { username: { contains: q } },
            { firstName: { contains: q } },
            { referralCode: { contains: q } },
            ...(Number.isFinite(Number(q)) ? [{ telegramId: BigInt(q) }] : []),
          ],
        }
      : undefined;
    const list = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        ledger: true,
        wallets: true,
        _count: { select: { orders: true, deposits: true, withdrawals: true } },
      },
    });
    return list.map((u) => this.serializeUser(u));
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        ledger: { include: { entries: { orderBy: { createdAt: 'desc' }, take: 30 } } },
        wallets: true,
        deposits: { orderBy: { createdAt: 'desc' }, take: 30 },
        orders: { orderBy: { createdAt: 'desc' }, take: 30 },
        withdrawals: { orderBy: { createdAt: 'desc' }, take: 30 },
        referrals: {
          select: { id: true, username: true, firstName: true, telegramId: true, createdAt: true },
          take: 50,
        },
        referredBy: { select: { id: true, username: true, firstName: true } },
        sessions: { orderBy: { lastSeenAt: 'desc' }, take: 20 },
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const detail = this.serializeUserDetail(user);
    detail.wallets = await this.enrichWallets(user.wallets || []);
    return detail;
  }

  async getUserWalletBalances(userId: string) {
    const wallets = await this.prisma.walletAddress.findMany({ where: { userId } });
    if (!wallets.length) {
      const exists = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!exists) throw new NotFoundException('Пользователь не найден');
    }
    return this.enrichWallets(wallets, true);
  }

  private async estimatedWalletMicros(walletAddressId: string) {
    const credited = await this.prisma.deposit.aggregate({
      where: { walletAddressId, status: 'credited', source: 'onchain' },
      _sum: { amountMicros: true },
    });
    const swept = await this.prisma.sweepJob.aggregate({
      where: { walletAddressId, status: 'completed' },
      _sum: { amountMicros: true },
    });
    return (
      Number(credited._sum.amountMicros || 0) - Number(swept._sum.amountMicros || 0)
    );
  }

  private async enrichWallets(wallets: any[], fetchRpc = true) {
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const out = [];
    for (const w of wallets) {
      const estimatedMicros = await this.estimatedWalletMicros(w.id);
      let onchainUsdt: number | null = null;
      let onchainSource: 'rpc' | 'unavailable' | 'skipped' | 'invalid_address' =
        'skipped';
      let onchainError: string | undefined;
      if (fetchRpc) {
        const rpc = await fetchOnchainUsdt(w.network, w.address);
        onchainUsdt = rpc.usdt;
        onchainSource = rpc.source;
        onchainError = rpc.error;
      }
      const master =
        w.network === 'TON'
          ? settings?.masterTonAddress || process.env.MASTER_TON_ADDRESS || null
          : settings?.masterTrc20Address || process.env.MASTER_TRC20_ADDRESS || null;
      out.push({
        id: w.id,
        network: w.network,
        address: w.address,
        estimatedUsdt: Math.max(0, estimatedMicros) / 1e6,
        estimatedMicros: Math.max(0, estimatedMicros),
        onchainUsdt,
        onchainSource,
        onchainError,
        masterAddress: master || null,
        lastScannedAt: w.lastScannedAt,
        isValid: isValidOnchainAddress(w.network, w.address),
        derivationIdx: w.derivationIdx,
      });
    }
    return out;
  }

  serializeUserDetail(u: any) {
    const base = this.serializeUser(u);
    return {
      ...base,
      deposits: (u.deposits || []).map((d: any) => ({
        ...d,
        amountMicros: Number(d.amountMicros),
      })),
      orders: (u.orders || []).map((o: any) => this.serializeOrder(o)),
      withdrawals: (u.withdrawals || []).map((w: any) => ({
        ...w,
        amountMicros: Number(w.amountMicros),
        feeMicros: Number(w.feeMicros || 0),
      })),
      ledger: (u.ledger || []).map((a: any) => ({
        kind: a.kind,
        balance: Number(a.balance),
        entries: (a.entries || []).map((e: any) => ({
          id: e.id,
          amount: Number(e.amount),
          balanceAfter: Number(e.balanceAfter),
          reason: e.reason,
          createdAt: e.createdAt,
        })),
      })),
      wallets: (u.wallets || []).map((w: any) => ({
        id: w.id,
        network: w.network,
        address: w.address,
      })),
      referrals: (u.referrals || []).map((r: any) => ({
        ...r,
        telegramId: r.telegramId?.toString?.() ?? r.telegramId,
      })),
    };
  }

  async withdrawWallet(walletAddressId: string, body: unknown, adminId: string) {
    const parsed = adminWalletWithdrawSchema.parse(body ?? {});
    const wallet = await this.prisma.walletAddress.findUnique({
      where: { id: walletAddressId },
      include: { user: true },
    });
    if (!wallet) throw new NotFoundException('Кошелёк не найден');

    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    const master =
      wallet.network === 'TON'
        ? settings.masterTonAddress || process.env.MASTER_TON_ADDRESS
        : settings.masterTrc20Address || process.env.MASTER_TRC20_ADDRESS;
    const toAddress = (parsed.toAddress || master || '').trim();
    if (!toAddress) {
      throw new BadRequestException(
        `Укажите адрес назначения или задайте мастер-кошелёк ${wallet.network} в настройках`,
      );
    }

    const estimatedMicros = await this.estimatedWalletMicros(wallet.id);
    let amountMicros = estimatedMicros;
    if (parsed.amountUsdt != null && parsed.amountUsdt !== '') {
      const n =
        typeof parsed.amountUsdt === 'number'
          ? parsed.amountUsdt
          : Number(String(parsed.amountUsdt).replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestException('Некорректная сумма');
      }
      amountMicros = usdtToMicros(n);
    }
    if (amountMicros <= 0) {
      throw new BadRequestException('На депозитном адресе нет средств к сбору (по учёту)');
    }
    if (amountMicros > estimatedMicros) {
      throw new BadRequestException(
        `Доступно к сбору по учёту: ${(estimatedMicros / 1e6).toFixed(6)} USDT`,
      );
    }

    const userMin = wallet.user.minWithdrawUsdt;
    const minWd = userMin != null ? userMin : settings.minWithdrawUsdt;
    if (amountMicros / 1e6 < minWd) {
      throw new BadRequestException(`Мин. вывод для пользователя: ${minWd} USDT`);
    }

    await this.queue.enqueue(QUEUES.sweeps, 'maybe_sweep', {
      walletAddressId,
      force: true,
      toAddress,
      amountMicros,
    });
    // Always record in DB even without Redis worker
    const job = await this.sweeps.run(walletAddressId, {
      force: true,
      toAddress,
      amountMicros,
    });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'wallet_withdraw',
        entityType: 'WalletAddress',
        entityId: walletAddressId,
        meta: {
          network: wallet.network,
          from: wallet.address,
          to: toAddress,
          amountMicros,
          userId: wallet.userId,
          sweepJobId: job?.id,
        },
      },
    });

    return {
      ok: true,
      walletAddressId,
      network: wallet.network,
      fromAddress: wallet.address,
      toAddress,
      amountUsdt: amountMicros / 1e6,
      sweep: job,
    };
  }

  async createUser(body: unknown, adminId: string) {
    const parsed = adminCreateUserSchema.parse(body);
    const telegramId = BigInt(parsed.telegramId);
    const existing = await this.prisma.user.findUnique({ where: { telegramId } });
    if (existing) throw new BadRequestException('Пользователь с таким Telegram ID уже есть');

    let code = generateReferralCode();
    for (let i = 0; i < 5; i++) {
      const clash = await this.prisma.user.findUnique({ where: { referralCode: code } });
      if (!clash) break;
      code = generateReferralCode();
    }

    const user = await this.prisma.user.create({
      data: {
        telegramId,
        username: parsed.username || null,
        firstName: parsed.firstName || null,
        referralCode: code,
      },
    });
    await this.ledger.getBalances(user.id);
    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'create_user',
        entityType: 'User',
        entityId: user.id,
        meta: { telegramId: String(telegramId) },
      },
    });
    return this.getUser(user.id);
  }

  async updateUser(id: string, body: unknown, adminId: string) {
    const parsed = adminUserUpdateSchema.parse(body);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    await this.prisma.user.update({
      where: { id },
      data: {
        status: parsed.status,
        notes: parsed.notes,
        minDepositUsdt: parsed.minDepositUsdt === null ? null : parsed.minDepositUsdt,
        maxWithdrawUsdt: parsed.maxWithdrawUsdt === null ? null : parsed.maxWithdrawUsdt,
        minWithdrawUsdt: parsed.minWithdrawUsdt === null ? null : parsed.minWithdrawUsdt,
        withdrawFrozen: parsed.withdrawFrozen,
        isAdmin: parsed.isAdmin,
        firstName: parsed.firstName,
        username: parsed.username,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'update_user',
        entityType: 'User',
        entityId: id,
        meta: parsed,
      },
    });
    return this.getUser(id);
  }

  async deleteUser(id: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();

    await this.prisma.$transaction(async (tx) => {
      const accounts = await tx.ledgerAccount.findMany({ where: { userId: id } });
      for (const a of accounts) {
        await tx.ledgerEntry.deleteMany({ where: { accountId: a.id } });
      }
      await tx.ledgerAccount.deleteMany({ where: { userId: id } });
      await tx.referralEarning.deleteMany({
        where: { OR: [{ earnerId: id }, { sourceUserId: id }] },
      });
      await tx.withdrawal.deleteMany({ where: { userId: id } });
      await tx.exchangeOrder.deleteMany({ where: { userId: id } });
      await tx.deposit.deleteMany({ where: { userId: id } });
      const wallets = await tx.walletAddress.findMany({ where: { userId: id } });
      for (const w of wallets) {
        await tx.sweepJob.deleteMany({ where: { walletAddressId: w.id } });
      }
      await tx.walletAddress.deleteMany({ where: { userId: id } });
      await tx.user.updateMany({ where: { referredById: id }, data: { referredById: null } });
      await tx.user.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'delete_user',
          entityType: 'User',
          entityId: id,
          meta: { telegramId: String(user.telegramId) },
        },
      });
    });

    return { ok: true };
  }

  async adjustBalance(id: string, body: unknown, adminId: string) {
    const parsed = adminAdjustBalanceSchema.parse(body);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    const micros = usdtToMicros(parsed.amountUsdt);
    if (micros <= 0) throw new BadRequestException('Сумма должна быть > 0');

    if (parsed.direction === 'credit') {
      await this.ledger.credit(id, 'available', micros, parsed.reason, {
        type: 'admin',
        id: adminId,
      });
    } else {
      await this.ledger.debit(id, 'available', micros, parsed.reason, {
        type: 'admin',
        id: adminId,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'adjust_balance',
        entityType: 'User',
        entityId: id,
        meta: { ...parsed, micros },
      },
    });
    return this.getUser(id);
  }

  async listOrders(status?: string) {
    const list = await this.prisma.exchangeOrder.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: true, withdrawal: true },
    });
    return list.map((o) => this.serializeOrder(o));
  }

  async getOrder(id: string) {
    const order = await this.prisma.exchangeOrder.findUnique({
      where: { id },
      include: { user: true, withdrawal: true, payments: { orderBy: { seq: 'asc' } } },
    });
    if (!order) throw new NotFoundException();
    return this.serializeOrder(order);
  }

  async listDeposits() {
    const list = await this.prisma.deposit.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: true },
    });
    return list.map((d) => ({
      ...d,
      amountMicros: Number(d.amountMicros),
      user: d.user
        ? {
            ...d.user,
            telegramId: d.user.telegramId.toString(),
          }
        : null,
    }));
  }

  async listWithdrawals() {
    const list = await this.prisma.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: true },
    });
    return list.map((w) => ({
      ...w,
      amountMicros: Number(w.amountMicros),
      feeMicros: Number(w.feeMicros || 0),
      user: w.user
        ? { ...w.user, telegramId: w.user.telegramId.toString() }
        : null,
    }));
  }

  async getWithdrawal(id: string) {
    const w = await this.prisma.withdrawal.findUniqueOrThrow({
      where: { id },
      include: { user: true },
    });
    return {
      ...w,
      amountMicros: Number(w.amountMicros),
      feeMicros: Number(w.feeMicros || 0),
      user: w.user
        ? { ...w.user, telegramId: w.user.telegramId.toString() }
        : null,
    };
  }

  async audit(
    adminId: string,
    action: string,
    entityType: string,
    entityId: string,
    meta?: unknown,
  ) {
    await this.prisma.auditLog.create({
      data: {
        adminId,
        action,
        entityType,
        entityId,
        meta: meta as any,
      },
    });
  }

  /** Рассылка в Telegram всем, кто принял правила */
  async broadcastTelegram(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML') {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new BadRequestException('BOT_TOKEN не настроен — рассылка невозможна');
    }
    const users = await this.prisma.user.findMany({
      where: { status: 'active', rulesAcceptedAt: { not: null } },
      select: { telegramId: true },
    });
    let ok = 0;
    let fail = 0;
    for (const u of users) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: u.telegramId.toString(),
            text,
            parse_mode: parseMode,
          }),
        });
        if (res.ok) ok++;
        else fail++;
        await new Promise((r) => setTimeout(r, 35));
      } catch {
        fail++;
      }
    }
    return { ok, fail, total: users.length };
  }

  async listSweeps() {
    const list = await this.prisma.sweepJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { walletAddress: true },
    });
    return list.map((s) => ({
      ...s,
      amountMicros: Number(s.amountMicros),
    }));
  }

  async listWallets() {
    const list = await this.prisma.walletAddress.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, username: true, firstName: true, telegramId: true } } },
    });
    const enriched = await this.enrichWallets(list, true);
    const byId = new Map(enriched.map((w) => [w.id, w]));
    return list.map((w) => {
      const e = byId.get(w.id);
      return {
        id: w.id,
        network: w.network,
        address: w.address,
        lastScannedAt: w.lastScannedAt,
        createdAt: w.createdAt,
        derivationIdx: w.derivationIdx,
        user: w.user
          ? { ...w.user, telegramId: w.user.telegramId.toString() }
          : null,
        estimatedUsdt: e?.estimatedUsdt ?? 0,
        onchainUsdt: e?.onchainUsdt ?? null,
        onchainSource: e?.onchainSource,
        onchainError: e?.onchainError,
        masterAddress: e?.masterAddress ?? null,
        isValid: e?.isValid ?? false,
      };
    });
  }

  async getWalletSecrets(walletAddressId: string) {
    const w = await this.prisma.walletAddress.findUnique({
      where: { id: walletAddressId },
      include: { user: { select: { telegramId: true, username: true } } },
    });
    if (!w) throw new NotFoundException('Кошелёк не найден');
    let privateKey = '';
    try {
      privateKey = revealWalletKey(w.privateKeyEnc);
    } catch {
      privateKey = '';
    }
    const mnemonic = masterMnemonicHint(w.network);
    const envKey = w.network === 'TON' ? 'TON_HD_MNEMONIC' : 'TRON_HD_MNEMONIC';
    const fullMnemonic = readMasterMnemonic(w.network);
    return {
      id: w.id,
      network: w.network,
      address: w.address,
      derivationIdx: w.derivationIdx,
      derivationPath: `deposit/${w.derivationIdx}`,
      privateKey,
      isValid: isValidOnchainAddress(w.network, w.address),
      masterMnemonicEnv: envKey,
      masterMnemonicConfigured: mnemonic.configured,
      masterMnemonicPreview: mnemonic.preview || null,
      masterMnemonic: fullMnemonic,
      user: w.user
        ? {
            telegramId: w.user.telegramId.toString(),
            username: w.user.username,
          }
        : null,
      note:
        w.network === 'TON'
          ? fullMnemonic
            ? 'TON: импорт по seed мастер-фразы (тот же index) или через private key.'
            : 'TON: импорт через private key в совместимых кошельках.'
          : 'TRC20: private key можно импортировать в TronLink / Trust Wallet.',
    };
  }

  async regenerateWallet(walletAddressId: string, adminId: string) {
    const w = await this.prisma.walletAddress.findUniqueOrThrow({
      where: { id: walletAddressId },
    });
    const count = await this.prisma.walletAddress.count({ where: { network: w.network } });
    const derived = deriveDepositWallet(w.network, count + 1000 + Date.now() % 100000);
    const updated = await this.prisma.walletAddress.update({
      where: { id: w.id },
      data: {
        address: derived.address,
        privateKeyEnc: derived.privateKeyEnc,
        derivationIdx: derived.derivationIdx,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'regenerate_wallet',
        entityType: 'WalletAddress',
        entityId: w.id,
        meta: { oldAddress: w.address, newAddress: updated.address, network: w.network },
      },
    });
    return {
      id: updated.id,
      network: updated.network,
      address: updated.address,
      derivationIdx: updated.derivationIdx,
      isValid: true,
    };
  }

  async triggerSweep(walletAddressId?: string) {
    if (walletAddressId) {
      await this.queue.enqueue(QUEUES.sweeps, 'maybe_sweep', {
        walletAddressId,
        force: true,
      });
      const job = await this.sweeps.run(walletAddressId, { force: true });
      return { ok: true, walletAddressId, sweep: job, enqueued: 1 };
    }
    const wallets = await this.prisma.walletAddress.findMany({ take: 500 });
    let done = 0;
    for (const w of wallets) {
      await this.queue.enqueue(QUEUES.sweeps, 'maybe_sweep', {
        walletAddressId: w.id,
        force: true,
      });
      const job = await this.sweeps.run(w.id, { force: true });
      if (job) done += 1;
    }
    return { ok: true, enqueued: wallets.length, completed: done };
  }

  serializeUser(u: any) {
    return {
      ...u,
      telegramId: u.telegramId?.toString?.() ?? u.telegramId,
      loyaltyVolume: Number(u.loyaltyVolume || 0),
      rubTurnover: Number(u.rubTurnover || 0),
      ledger: (u.ledger || []).map((a: any) => ({
        kind: a.kind,
        balance: Number(a.balance),
      })),
      wallets: u.wallets,
      _count: u._count,
    };
  }
}
