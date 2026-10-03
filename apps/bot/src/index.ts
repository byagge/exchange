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
 * Premium emoji pack (HTML <tg-emoji>).
 * Fallback unicode inside the tag for clients without custom emoji.
 */
const E = {
  menu: { id: '5377336227533969892', f: '☰' },
  heart: { id: '5911484439505936397', f: '❤️' },
  folder: { id: '5911489516157280180', f: '📁' },
  bookmark: { id: '5911251317271043972', f: '🔖' },
  lock: { id: '5911323373937369033', f: '🔒' },
  shield: { id: '5911379646598880549', f: '🛡' },
  warn: { id: '5911145411967459937', f: '⚠️' },
  ban: { id: '5911501675209694593', f: '🚫' },
  monitor: { id: '5909217749040635755', f: '💻' },
  info: { id: '5910994954968113783', f: 'ℹ️' },
  megaphone: { id: '5909124470940901643', f: '📣' },
  check: { id: '5911055144639799125', f: '✅' },
  cart: { id: '5911362634233421746', f: '🛒' },
  trash: { id: '5911143453462372194', f: '🗑' },
  clock: { id: '5911276936750964150', f: '⏱' },
  briefcase: { id: '5909275524940702226', f: '💼' },
  search: { id: '5911028421353285215', f: '🔍' },
  pin: { id: '5911464351943892212', f: '📌' },
  user: { id: '5908952869817557105', f: '👤' },
  users: { id: '5908795012589560198', f: '👥' },
  wallet: { id: '5908947788871246223', f: '👛' },
  at: { id: '5911352098678644390', f: '@' },
  crown: { id: '5911453258043368257', f: '👑' },
  link: { id: '5909164332532376529', f: '🔗' },
  gift: { id: '5911358979216251585', f: '🎁' },
  chart: { id: '591110355751159614', f: '📈' },
  home: { id: '5908975658914030178', f: '🏠' },
  robot: { id: '5911350127288655523', f: '🤖' },
  star: { id: '5911080141349461495', f: '⭐' },
  layers: { id: '5911230542514233531', f: '📚' },
  arrow: { id: '5909164014704796217', f: '↗️' },
  down: { id: '5911001882750360915', f: '⬇️' },
  flask: { id: '5910995388759811013', f: '🧪' },
  bell: { id: '5911258945132962452', f: '🔔' },
  ton: { id: '5911239046549478950', f: '💎' },
  usdt: { id: '5911473113677176791', f: '₮' },
  swap: { id: '5909224668232952203', f: '💱' },
  tron: { id: '5911054161092288272', f: '🔴' },
  ok: { id: '5911473599008480053', f: '✅' },
  question: { id: '5911175201860625958', f: '❓' },
  dollar: { id: '5910984870384902405', f: '$' },
  ruble: { id: '5911388322432820088', f: '₽' },
  cross: { id: '5911501675209694593', f: '❌' },
  support: { id: '5377650268987465369', f: '🆘' },
  wave: { id: '5911484439505936397', f: '👋' },
  doc: { id: '5911245291431929370', f: '📄' },
  back: { id: '5911001882750360915', f: '⬅️' },
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

function moneyUsd(micros: number | bigint) {
  const n = Number(micros) / 1e6;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moneyRub(kopecks: number | bigint) {
  const n = Number(kopecks) / 100;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ORDER_STATUS: Record<string, string> = {
  draft: 'Черновик',
  awaiting_funds: 'Ожидает средств',
  locked: 'Заблокирована',
  processing: 'В обработке',
  awaiting_payout: 'Ожидает выплаты',
  completed: 'Завершена',
  cancelled: 'Отменена',
  failed: 'Ошибка',
  disputed: 'Спор',
};

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

/** Blue primary WebApp button */
function openAppInlineRow(): Record<string, unknown>[] {
  return [
    {
      text: `${E.monitor.f} Открыть приложение`,
      web_app: { url: webappUrl },
      style: 'primary',
      icon_custom_emoji_id: E.monitor.id,
    },
  ];
}

function mainMenuKeyboard(admin: boolean) {
  const rows: Record<string, unknown>[][] = [
    openAppInlineRow(),
    [
      { text: `${E.user.f} Профиль`, callback_data: 'menu:profile', icon_custom_emoji_id: E.user.id },
      {
        text: `${E.support.f} Поддержка`,
        callback_data: 'menu:support',
        icon_custom_emoji_id: E.support.id,
      },
    ],
  ];
  if (admin) {
    rows.push([
      {
        text: `${E.megaphone.f} Админ · рассылка`,
        callback_data: 'admin:broadcast',
        icon_custom_emoji_id: E.megaphone.id,
      },
    ]);
  }
  const kb = new InlineKeyboard();
  (kb as any).inline_keyboard = rows;
  return kb;
}

function replyMenuKeyboard(admin: boolean) {
  const rows: Record<string, unknown>[][] = [
    [
      {
        text: `${E.monitor.f} Открыть приложение`,
        web_app: { url: webappUrl },
        icon_custom_emoji_id: E.monitor.id,
      },
    ],
    [
      { text: `${E.user.f} Профиль`, icon_custom_emoji_id: E.user.id },
      { text: `${E.support.f} Поддержка`, icon_custom_emoji_id: E.support.id },
    ],
  ];
  if (admin) {
    rows.push([{ text: `${E.megaphone.f} Рассылка`, icon_custom_emoji_id: E.megaphone.id }]);
  }
  const kb = new Keyboard();
  (kb as any).keyboard = rows;
  return kb.resized().persistent();
}

function profileActionsKeyboard() {
  return new InlineKeyboard()
    .text(`${E.chart.f} Курс`, 'menu:rate')
    .text(`${E.layers.f} Заявки`, 'menu:orders');
}

async function profileText(user: {
  id: string;
  username: string | null;
  firstName: string | null;
  telegramId: bigint;
  tradeCount: number;
}) {
  const [available, referral] = await Promise.all([
    prisma.ledgerAccount.findUnique({
      where: { userId_kind: { userId: user.id, kind: 'available' } },
    }),
    prisma.ledgerAccount.findUnique({
      where: { userId_kind: { userId: user.id, kind: 'referral' } },
    }),
  ]);
  const nick = user.username ? `@${user.username}` : user.firstName || '—';
  const deals = user.tradeCount ?? 0;
  return (
    `${pe('question')} <b>Информация</b>\n` +
    `├ Никнейм: ${nick}\n` +
    `├ ID: <code>${user.telegramId.toString()}</code>\n` +
    `╰ Кол-во сделок: ${deals}\n\n` +
    `${pe('question')} <b>Финансы</b>\n` +
    `├ Баланс: ${pe('dollar')} ${moneyUsd(available?.balance || 0)}\n` +
    `╰ Реферальный баланс: ${pe('dollar')} ${moneyUsd(referral?.balance || 0)}`
  );
}

async function showProfile(
  ctx: Context,
  user: {
    id: string;
    username: string | null;
    firstName: string | null;
    telegramId: bigint;
    tradeCount: number;
  },
  edit = false,
) {
  const text = await profileText(user);
  const markup = profileActionsKeyboard();
  if (edit) await editHtml(ctx, text, { reply_markup: markup });
  else await replyHtml(ctx, text, { reply_markup: markup });
}

async function showRate(ctx: Context, edit = false) {
  const s = await settings();
  const rate = s?.usdtRubRate || process.env.DEFAULT_USDT_RUB_RATE || '98.01';
  const text =
    `${pe('chart')} <b>Курс</b>\n\n` +
    `${pe('usdt')} USDT ${pe('swap')} ${pe('ruble')} RUB\n` +
    `1 USDT = <b>${rate}</b> ₽`;
  const kb = new InlineKeyboard().text(`${E.back.f} Назад`, 'menu:profile');
  if (edit) await editHtml(ctx, text, { reply_markup: kb });
  else await replyHtml(ctx, text, { reply_markup: kb });
}

async function showOrdersList(ctx: Context, userId: string, edit = false) {
  const orders = await prisma.exchangeOrder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const kb = new InlineKeyboard();
  if (!orders.length) {
    const text = `${pe('layers')} <b>Заявки</b>\n\nЗаявок пока нет.`;
    kb.text(`${E.back.f} Назад`, 'menu:profile');
    if (edit) await editHtml(ctx, text, { reply_markup: kb });
    else await replyHtml(ctx, text, { reply_markup: kb });
    return;
  }
  for (const o of orders) {
    const usdt = moneyUsd(o.fromAmountMicros);
    const st = ORDER_STATUS[o.status] || o.status;
    const short = o.id.slice(-6).toUpperCase();
    kb.text(`${E.swap.f} #${short} · ${usdt} · ${st}`, `order:${o.id}`).row();
  }
  kb.text(`${E.back.f} Назад`, 'menu:profile');
  const text = `${pe('layers')} <b>Заявки</b>\n\nВыберите заявку:`;
  if (edit) await editHtml(ctx, text, { reply_markup: kb });
  else await replyHtml(ctx, text, { reply_markup: kb });
}

async function showOrderDetail(ctx: Context, orderId: string, userId: string) {
  const order = await prisma.exchangeOrder.findFirst({
    where: { id: orderId, userId },
  });
  if (!order) {
    await editHtml(ctx, `${pe('warn')} Заявка не найдена.`, {
      reply_markup: new InlineKeyboard().text(`${E.back.f} Назад`, 'menu:orders'),
    });
    return;
  }
  const req = (order.requisites || {}) as Record<string, unknown>;
  const bank = req.bank ? String(req.bank) : '—';
  const fio = req.fio ? String(req.fio) : '—';
  const card = req.card || req.phone || req.requisite || '—';
  const text =
    `${pe('swap')} <b>Заявка #${order.id.slice(-6).toUpperCase()}</b>\n\n` +
    `${pe('pin')} Статус: <b>${ORDER_STATUS[order.status] || order.status}</b>\n` +
    `${pe('usdt')} Сумма: <b>${moneyUsd(order.fromAmountMicros)}</b> USDT\n` +
    `${pe('ruble')} К получению: <b>${moneyRub(order.payoutAmountKopecks ?? order.toAmountKopecks)}</b> ₽\n` +
    `${pe('chart')} Курс: <b>${order.rate}</b>\n` +
    `${pe('briefcase')} Банк: ${bank}\n` +
    `${pe('user')} ФИО: ${fio}\n` +
    `${pe('at')} Реквизиты: <code>${String(card)}</code>\n` +
    `${pe('clock')} Создана: ${order.createdAt.toLocaleString('ru-RU')}`;
  const kb = new InlineKeyboard().text(`${E.back.f} Назад`, 'menu:orders');
  await editHtml(ctx, text, { reply_markup: kb });
}

async function showSupport(ctx: Context) {
  await replyHtml(
    ctx,
    `${pe('support')} <b>Поддержка</b>\n\n` +
      `По всем вопросам обращайтесь к оператору.\n` +
      `Укажите номер заявки при обращении.`,
  );
}

async function showMainMenu(ctx: Context) {
  const s = await settings();
  const welcome = s?.welcomeText || 'Добро пожаловать в Exchange.';
  const admin = isAdminTg(ctx);

  // 1) menu emoji first + reply keyboard
  try {
    await ctx.reply(pe('menu'), {
      parse_mode: 'HTML',
      reply_markup: replyMenuKeyboard(admin),
    });
  } catch {
    await ctx.reply(E.menu.f, { reply_markup: replyMenuKeyboard(admin) });
  }

  // 2) then main menu with inline buttons
  await replyHtml(ctx, `${pe('home')} <b>${welcome}</b>`, {
    reply_markup: mainMenuKeyboard(admin),
  });
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

  bot.callbackQuery('menu:profile', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await ensureUser(ctx);
    if (!user) return;
    const text = await profileText(user);
    const markup = profileActionsKeyboard();
    const edited = await editHtml(ctx, text, { reply_markup: markup });
    if (!edited) await replyHtml(ctx, text, { reply_markup: markup });
  });

  bot.callbackQuery('menu:rate', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRate(ctx, true);
  });

  bot.callbackQuery('menu:orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await ensureUser(ctx);
    if (!user) return;
    await showOrdersList(ctx, user.id, true);
  });

  bot.callbackQuery(/^order:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await ensureUser(ctx);
    if (!user) return;
    await showOrderDetail(ctx, ctx.match![1], user.id);
  });

  bot.callbackQuery('menu:support', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSupport(ctx);
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
        `${pe('ok')} Доставлено: <b>${ok}</b>\n` +
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
    await replyHtml(ctx, `${pe('monitor')} Exchange`, {
      reply_markup: mainMenuKeyboard(isAdminTg(ctx)),
    });
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
      await replyHtml(ctx, `${pe('monitor')} Exchange`, {
        reply_markup: mainMenuKeyboard(isAdminTg(ctx)),
      });
      return;
    }
    if (text.includes('Профиль') || text.includes('Баланс')) {
      await showProfile(ctx, user, false);
      return;
    }
    if (text.includes('Поддержка')) {
      await showSupport(ctx);
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
