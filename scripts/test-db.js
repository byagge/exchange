process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:C:/exdb/dev.db';

async function main() {
  console.log('DATABASE_URL=', process.env.DATABASE_URL);
  const { PrismaClient } = require('../packages/db/node_modules/@prisma/client');
  const p = new PrismaClient();
  await p.$connect();
  const s = await p.settings.findUnique({ where: { id: 1 } });
  console.log('OK settings=', JSON.stringify(s));
  const admins = await p.adminUser.count();
  console.log('admins=', admins);
  await p.$disconnect();
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
