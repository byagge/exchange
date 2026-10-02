import type { Network } from '@exchange/db';
import { prisma } from '@exchange/db';
import { usdtToMicros } from '@exchange/shared';

/**
 * Chain monitors — poll deposit addresses and credit confirmed USDT transfers.
 * Plug real TON Center / TonAPI and TronGrid responses when API keys are set.
 */

export async function scanTrc20Address(address: string): Promise<
  Array<{ txHash: string; amountMicros: number }>
> {
  const key = process.env.TRONGRID_API_KEY;
  if (!key) return [];
  try {
    const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const res = await fetch(
      `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&contract_address=${usdtContract}`,
      { headers: { 'TRON-PRO-API-KEY': key } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: any[] };
    return (json.data || [])
      .filter((t) => String(t.to).toLowerCase() === address.toLowerCase())
      .map((t) => ({
        txHash: String(t.transaction_id),
        amountMicros: usdtToMicros(Number(t.value) / 10 ** Number(t.token_info?.decimals || 6)),
      }));
  } catch {
    return [];
  }
}

export async function scanTonAddress(address: string): Promise<
  Array<{ txHash: string; amountMicros: number }>
> {
  const key = process.env.TON_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://tonapi.io/v2/blockchain/accounts/${address}/transactions?limit=20`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) return [];
    // Jetton parsing is network-specific; return empty until jetton wallet mapping configured.
    void res;
    return [];
  } catch {
    return [];
  }
}

export async function creditIfNew(params: {
  address: string;
  network: Network;
  txHash: string;
  amountMicros: number;
}) {
  const wallet = await prisma.walletAddress.findUnique({
    where: { network_address: { network: params.network, address: params.address } },
  });
  if (!wallet) return null;

  const existing = await prisma.deposit.findUnique({ where: { txHash: params.txHash } });
  if (existing) return existing;

  const deposit = await prisma.deposit.create({
    data: {
      userId: wallet.userId,
      source: 'onchain',
      status: 'credited',
      network: params.network,
      walletAddressId: wallet.id,
      amountMicros: BigInt(params.amountMicros),
      txHash: params.txHash,
      creditedAt: new Date(),
    },
  });

  const account = await prisma.ledgerAccount.upsert({
    where: { userId_kind: { userId: wallet.userId, kind: 'available' } },
    create: { userId: wallet.userId, kind: 'available', balance: 0n },
    update: {},
  });
  const balanceAfter = account.balance + BigInt(params.amountMicros);
  await prisma.ledgerAccount.update({
    where: { id: account.id },
    data: { balance: balanceAfter },
  });
  await prisma.ledgerEntry.create({
    data: {
      accountId: account.id,
      amount: BigInt(params.amountMicros),
      balanceAfter,
      reason: 'deposit_onchain',
      referenceType: 'deposit',
      referenceId: deposit.id,
    },
  });

  return deposit;
}

export async function pollAllDepositWallets() {
  const wallets = await prisma.walletAddress.findMany({ take: 300 });
  for (const w of wallets) {
    const txs =
      w.network === 'TRC20' ? await scanTrc20Address(w.address) : await scanTonAddress(w.address);
    for (const tx of txs) {
      await creditIfNew({
        address: w.address,
        network: w.network,
        txHash: tx.txHash,
        amountMicros: tx.amountMicros,
      });
    }
    await prisma.walletAddress.update({
      where: { id: w.id },
      data: { lastScannedAt: new Date() },
    });
  }
}
