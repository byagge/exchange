import { PrismaClient, AdminRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      usdtRubRate: process.env.DEFAULT_USDT_RUB_RATE || '98.01',
      sweepThresholdUsdt: Number(process.env.SWEEP_THRESHOLD_USDT || 50),
      masterTonAddress: process.env.MASTER_TON_ADDRESS || null,
      masterTrc20Address: process.env.MASTER_TRC20_ADDRESS || null,
    },
    update: {
      masterTonAddress: process.env.MASTER_TON_ADDRESS || undefined,
      masterTrc20Address: process.env.MASTER_TRC20_ADDRESS || undefined,
      sweepThresholdUsdt: process.env.SWEEP_THRESHOLD_USDT
        ? Number(process.env.SWEEP_THRESHOLD_USDT)
        : undefined,
    },
  });

  const email = process.env.ADMIN_EMAIL || 'admin@exchange.local';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const hash = await bcrypt.hash(password, 12);

  await prisma.adminUser.upsert({
    where: { email },
    create: {
      email,
      passwordHash: hash,
      name: 'Super Admin',
      role: AdminRole.superadmin,
    },
    update: {
      passwordHash: hash,
    },
  });

  console.log('Seed OK:', { email, rate: process.env.DEFAULT_USDT_RUB_RATE || '98.01' });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
