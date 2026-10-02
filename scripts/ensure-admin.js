const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user
  .upsert({
    where: { telegramId: BigInt('780404501') },
    create: {
      telegramId: BigInt('780404501'),
      referralCode: 'ADMIN001',
      isAdmin: true,
      rulesAcceptedAt: new Date(),
      firstName: 'Admin',
    },
    update: { isAdmin: true },
  })
  .then((u) => {
    console.log('admin', u.id, String(u.telegramId), u.isAdmin);
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
