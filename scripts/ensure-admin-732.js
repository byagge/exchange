const { PrismaClient } = require('../packages/db/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const id = BigInt('732092704');
  const u = await p.user.upsert({
    where: { telegramId: id },
    create: {
      telegramId: id,
      referralCode: 'ADM7320',
      isAdmin: true,
      rulesAcceptedAt: new Date(),
      firstName: 'Admin',
    },
    update: { isAdmin: true },
  });
  console.log('admin', String(u.telegramId), u.isAdmin);
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
