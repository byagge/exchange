import dotenv from 'dotenv';
import path from 'path';
import { Bot, InlineKeyboard, Keyboard, GrammyError, HttpError, Context } from 'grammy';
import { prisma } from '@exchange/db';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const token = process.env.BOT_TOKEN;
const webappUrl = process.env.WEBAPP_URL || 'https://exchange.arix.vu';

/** Pending referral until rules accepted */
const pendingRef = new Map<number, string>();
/** Admin broadcast draft */
const broadcastDraft = new Map<number, string>();

/**
 * Premium / custom emoji (HTML).
 * Fallback unicode always inside the tag — clients without support show it.
 * If Telegram rejects custom emoji for the bot, sendHtml() strips tags.
 */
const E = {
  check: { id: '5206607081334906820', f: '✅' },
  cross: { id: '5210952531676504517', f: '❌' },
  rocket: { id: '5420315771991497307', f: '🚀' },
  money: { id: '5375296308752336103', f: '💰' },
  support: { id: '5377650268987465369', f: '🆘' },
  shield: { id: '5231200819986047251', f: '🛡' },
  fire: { id: '5260293721622489940', f: '🔥' },
  star: { id: '5312536423388701701', f: '⭐' },
  wave: { id: '5199740266093539511', f: '👋' },
  doc: { id: '5438496463044752972', f: '📄' },
  lock: { id: '5312241691446050903', f: '🔒' },
  wallet: { id: '5373012449597335010', f: '💼' },
  megaphone: { id: '5287690725441733097', f: '📣' },
  clock: { id: '5307751747479206039', f: '⏳' },
  warn: { id: '5447644880824197468', f: '⚠️' },
  spark: { id: '5452066204812941472', f: '✨' },
  point: { id: '5413700062947247593', f: '👇' },
  link: { id: '5271604874410266319', f: '🔗' },
} as const;

type EKey = keyof typeof E;

function pe(key: EKey): string {
  const e = E[key];
  return `<tg-emoji emoji-id="${e.id}">${e.f}</tg-emoji>`;
}

function stripPremium(html: string) {
  return html.replace(/<tg-emoji emoji-id="[^"]*">([^<]*)<\/tg-emoji>/g, '$1');
}

async function replyHtml(
  ctx: Context,
  text: string,
  extra: Record<string, unknown> = {},
) {
  const opts = { parse_mode: 'HTML' as const, ...extra };
  try {
    return await ctx.reply(text, opts);
  } catch (err: any) {
    const desc = String(err?.description || err?.message || '');
    if (/custom.?emoji|ENTITY|can't parse|PARSE/i.test(desc) || err?.error_code === 400) {
      return await ctx.reply(stripPremium(text), opts);
    }
    throw err;
  }
}

async function editHtml(ctx: Context, text: string, extra: Record<string, unknown> = {}) {
  const opts = { parse_mode: 'HTML' as const, ...extra };
  try {
    return await ctx.editMessageText(text, opts);
  } catch (err: any) {
    const desc = String(err?.description || err?.message || '');
    if (/custom.?emoji|ENTITY|can't parse|PARSE/i.test(desc) || err?.error_code === 400) {
      try {
        return await ctx.editMessageText(stripPremium(text), opts);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function adminIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function isAdminTg(ctx: Context) {
  const id = ctx.from?.id?.toString();
  return !!id && adminIds().has(id);
}

async function settings() {
  try {
    return await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  } catch {
    return null;
  }
}

async function ensureUser(ctx: Context) {
  const from = ctx.from;
  if (!from) return null;
  const telegramId = BigInt(from.id);
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        username: from.username || existing.username,
        firstName: from.first_name || existing.firstName,
        lastName: from.last_name || existing.lastName,
        languageCode: from.language_code || existing.languageCode,
        isAdmin: existing.isAdmin || adminIds().has(String(from.id)),
      },
    });
  }

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const gen = () => {
    let out = '';
    for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  };
  let referralCode = gen();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.user.findUnique({ where: { referralCode } });
    if (!clash) break;
    referralCode = gen();
  }

  let referredById: string | undefined;
  const ref = pendingRef.get(from.id);
  if (ref) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: ref } });
    if (referrer && referrer.telegramId !== telegramId) referredById = referrer.id;
  }

  return prisma.user.create({
    data: {
      telegramId,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      languageCode: from.language_code,
      referralCode,
      referredById,
      isAdmin: adminIds().has(String(from.id)),
    },
  });
}

function rulesKeyboard() {
  return new InlineKeyboard().text(`${E.check.f} Принимаю правила`, 'rules:accept');
}

function openAppButton(kb: InlineKeyboard, label = `${E.rocket.f} Открыть Exchange`) {
  kb.webApp(label, webappUrl);
  return kb;
}

function mainMenuKeyboard(admin: boolean) {
  const kb = new InlineKeyboard();
  openAppButton(kb);
  kb.row()
    .text(`${E.money.f} Баланс`, 'menu:balance')
    .text(`${E.support.f} Поддержка`, 'menu:support');
  if (admin) {
    kb.row().text(`${E.megaphone.f} Админ · рассылка`, 'admin:broadcast');
  }
  return kb;
}

function replyMenuKeyboard(admin: boolean) {
  const kb = new Keyboard()
    .webApp(`${E.rocket.f} Открыть приложение`, webappUrl)
    .text(`${E.money.f} Баланс`)
    .row()
    .text(`${E.support.f} Поддержка`);
  if (admin) kb.row().text(`${E.megaphone.f} Рассылка`);
  return kb.resized().persistent();
}

async function showMainMenu(ctx: Context) {
  const s = await settings();
  const welcome = s?.welcomeText || 'Добро пожаловать в Exchange.';
  const admin = isAdminTg(ctx);
  await replyHtml(ctx, `${pe('spark')} <b>${welcome}</b>`, {
    reply_markup: mainMenuKeyboard(admin),
  });
  await ctx.reply('☰', { reply_markup: replyMenuKeyboard(admin) });
}

async function showRules(ctx: Context) {
  const s = await settings();
  const rules =
    (s as any)?.rulesText ||
    'Пользуясь сервисом, вы подтверждаете согласие с правилами обмена.';
  const welcome = s?.welcomeText || 'Exchange';
  await replyHtml(
    ctx,
    `${pe('wave')} <b>${welcome}</b>\n\n` +
      `${pe('doc')} <b>Правила сервиса</b>\n\n` +
      `${rules}`,
    { reply_markup: rulesKeyboard() },
  );
}

async function main() {
  if (!token) {
    console.log('Bot idle (no BOT_TOKEN). Set BOT_TOKEN in .env to enable.');
    setInterval(() => {}, 1 << 30);
    return;
  }

  const bot = new Bot(token);

  bot.command('start', async (ctx) => {
    const payload = (ctx.match?.toString() || '').trim();
    if (payload.startsWith('ref_')) {
      pendingRef.set(ctx.from!.id, payload.slice(4).toUpperCase());
    }

    const user = await ensureUser(ctx);
    if (!user) return;

    if (!user.rulesAcceptedAt) {
      await showRules(ctx);
      return;
    }
    await showMainMenu(ctx);
  });

  bot.callbackQuery('rules:accept', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) {
      await ctx.answerCallbackQuery({ text: 'Ошибка профиля', show_alert: true });
      return;
    }

    if (!user.rulesAcceptedAt) {
      await prisma.user.update({
        where: { id: user.id },
        data: { rulesAcceptedAt: new Date() },
      });
    }
    pendingRef.delete(ctx.from!.id);

    await ctx.answerCallbackQuery({ text: `${E.check.f} Правила приняты` });
    await editHtml(ctx, `${pe('check')} <b>Правила приняты</b>`);
    await showMainMenu(ctx);
  });

  bot.callbackQuery('menu:balance', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await ensureUser(ctx);
    if (!user) return;
    const acc = await prisma.ledgerAccount.findUnique({
      where: { userId_kind: { userId: user.id, kind: 'available' } },
    });
    const usdt = (Number(acc?.balance || 0) / 1e6).toFixed(2);
    const kb = new InlineKeyboard();
    openAppButton(kb, `${E.wallet.f} Открыть кошелёк`);
    await replyHtml(ctx, `${pe('money')} Доступно: <b>${usdt} USDT</b>`, {
      reply_markup: kb,
    });
  });

  bot.callbackQuery('menu:support', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = await settings();
    await replyHtml(
      ctx,
      `${pe('support')} Поддержка: ${s?.supportUrl || 'https://t.me/'}`,
    );
  });

  bot.callbackQuery('admin:broadcast', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdminTg(ctx)) {
      await replyHtml(ctx, `${pe('cross')} Недостаточно прав.`);
      return;
    }
    broadcastDraft.set(ctx.from!.id, '');
    await replyHtml(
      ctx,
      `${pe('megaphone')} <b>Рассылка</b>\n` +
        `Пришлите текст одним сообщением.\n` +
        `${pe('cross')} Отмена: /cancel`,
    );
  });

  bot.callbackQuery(/^admin:bc:(confirm|cancel)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isAdminTg(ctx)) return;
    const action = ctx.match![1];
    const draft = broadcastDraft.get(ctx.from!.id);
    if (action === 'cancel' || !draft) {
      broadcastDraft.delete(ctx.from!.id);
      await editHtml(ctx, `${pe('cross')} Рассылка отменена.`);
      return;
    }

    await editHtml(ctx, `${pe('clock')} Рассылка…`);
    const users = await prisma.user.findMany({
      where: { status: 'active', rulesAcceptedAt: { not: null } },
      select: { telegramId: true },
    });
    let ok = 0;
    let fail = 0;
    for (const u of users) {
      try {
        await ctx.api.sendMessage(u.telegramId.toString(), draft, { parse_mode: 'HTML' });
        ok++;
        await new Promise((r) => setTimeout(r, 35));
      } catch {
        fail++;
      }
    }
    broadcastDraft.delete(ctx.from!.id);
    await replyHtml(
      ctx,
      `${pe('check')} <b>Рассылка завершена</b>\n` +
        `${pe('spark')} Доставлено: <b>${ok}</b>\n` +
        `${pe('warn')} Ошибок: <b>${fail}</b>`,
    );
  });

  bot.command('cancel', async (ctx) => {
    broadcastDraft.delete(ctx.from!.id);
    await replyHtml(ctx, `${pe('check')} Ок.`);
  });

  bot.command('menu', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user?.rulesAcceptedAt) {
      await showRules(ctx);
      return;
    }
    await showMainMenu(ctx);
  });

  bot.command('app', async (ctx) => {
    const kb = new InlineKeyboard();
    openAppButton(kb);
    await replyHtml(ctx, `${pe('rocket')} Exchange`, { reply_markup: kb });
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    if (isAdminTg(ctx) && broadcastDraft.has(ctx.from!.id)) {
      const current = broadcastDraft.get(ctx.from!.id);
      if (current === '') {
        broadcastDraft.set(ctx.from!.id, text);
        await replyHtml(
          ctx,
          `${pe('megaphone')} <b>Предпросмотр</b>\n\n${text}\n\nОтправить всем?`,
          {
            reply_markup: new InlineKeyboard()
              .text(`${E.check.f} Отправить`, 'admin:bc:confirm')
              .text(`${E.cross.f} Отмена`, 'admin:bc:cancel'),
          },
        );
        return;
      }
    }

    const user = await ensureUser(ctx);
    if (!user?.rulesAcceptedAt) {
      await showRules(ctx);
      return;
    }

    if (text.includes('Открыть приложение')) {
      const kb = new InlineKeyboard();
      openAppButton(kb);
      await replyHtml(ctx, `${pe('rocket')} Exchange`, { reply_markup: kb });
      return;
    }
    if (text.includes('Баланс')) {
      const acc = await prisma.ledgerAccount.findUnique({
        where: { userId_kind: { userId: user.id, kind: 'available' } },
      });
      const usdt = (Number(acc?.balance || 0) / 1e6).toFixed(2);
      const kb = new InlineKeyboard();
      openAppButton(kb, `${E.wallet.f} Открыть кошелёк`);
      await replyHtml(ctx, `${pe('money')} Доступно: <b>${usdt} USDT</b>`, {
        reply_markup: kb,
      });
      return;
    }
    if (text.includes('Поддержка')) {
      const s = await settings();
      await replyHtml(ctx, `${pe('support')} Поддержка: ${s?.supportUrl || 'https://t.me/'}`);
      return;
    }
    if (text.includes('Рассылка') && isAdminTg(ctx)) {
      broadcastDraft.set(ctx.from!.id, '');
      await replyHtml(
        ctx,
        `${pe('megaphone')} Пришлите текст рассылки.\n${pe('cross')} Отмена: /cancel`,
      );
      return;
    }

    await showMainMenu(ctx);
  });

  bot.catch((err) => {
    console.error(`Error update ${err.ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) console.error('Grammy:', e.description);
    else if (e instanceof HttpError) console.error('HTTP:', e);
    else console.error(e);
  });

  console.log('Bot starting…');
  await bot.start({
    onStart: (info) => console.log(`Bot @${info.username} online`),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
