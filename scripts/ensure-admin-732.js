const { PrismaClient } = require('../packages/db/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const ids = [BigInt('7320923704'), BigInt('780404501')];
  for (const id of ids) {
    const u = await p.user.upsert({
      where: { telegramId: id },
      create: {
        telegramId: id,
        referralCode: `ADM${id.toString().slice(-4)}`,
        isAdmin: true,
        rulesAcceptedAt: new Date(),
        firstName: 'Admin',
      },
      update: { isAdmin: true },
    });
    console.log('admin', String(u.telegramId), u.isAdmin);
  }
  // revoke mistaken short id if present
  try {
    await p.user.updateMany({
      where: { telegramId: BigInt('732092704') },
      data: { isAdmin: false },
    });
  } catch {
    /* ignore */
  }
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
