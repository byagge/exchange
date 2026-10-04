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
 * Premium emoji pack (custom emoji ids).
 * Fallback unicode inside the tag for clients without support.
 */
const E = {
  menu: { id: '5377336227533969892', f: '📱' },
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
  check2: { id: '5911473599008480053', f: '✅' },
  cart: { id: '5911362634233421746', f: '🛒' },
  trash: { id: '5911143453462372194', f: '🗑' },
  clock: { id: '5911276936750964150', f: '⏳' },
  briefcase: { id: '5909275524940702226', f: '💼' },
  search: { id: '5911028421353285215', f: '🔍' },
  pin: { id: '5911464351943892212', f: '📌' },
  user: { id: '5908952869817557105', f: '👤' },
  users: { id: '5908795012589560198', f: '👥' },
  terminal: { id: '5911143788469821823', f: '💻' },
  wallet: { id: '5908947788871246223', f: '👛' },
  at: { id: '5911352098678644390', f: '@' },
  crown: { id: '5911453258043368257', f: '👑' },
  cube: { id: '5911148804991624295', f: '🟦' },
  link: { id: '5909164332532376529', f: '🔗' },
  hammer: { id: '5909243381405459597', f: '🔨' },
  gift: { id: '5911358979216251585', f: '🎁' },
  game: { id: '5909070998598065571', f: '🎮' },
  house: { id: '5908975658914030178', f: '🏠' },
  robot: { id: '5911350127288655523', f: '🤖' },
  download: { id: '5910996634300326111', f: '⬇️' },
  star: { id: '5911080141349461495', f: '⭐' },
  layers: { id: '5911230542514233531', f: '📚' },
  arrow: { id: '5909164014704796217', f: '↗' },
  down: { id: '5911001882750360915', f: '⬇️' },
  bell: { id: '5911258945132962452', f: '🔔' },
  ton: { id: '5911239046549478950', f: '💎' },
  usdt: { id: '5911473113677176791', f: '💵' },
  swap: { id: '5909224668232952203', f: '💱' },
  tron: { id: '5911054161092288272', f: '🔴' },
  question: { id: '5911175201860625958', f: '❓' },
  excl: { id: '5911111563330201293', f: '❗' },
  dollar: { id: '5910984870384902405', f: '$' },
  rub: { id: '5911388322432820088', f: '₽' },
  percent: { id: '5911535691350679507', f: '%' },
  plus: { id: '5908947269180203065', f: '+' },
  minus: { id: '5911397221605056306', f: '−' },
  cross: { id: '5911501675209694593', f: '❌' },
  support: { id: '5911111563330201293', f: '🆘' },
  doc: { id: '5911245291431929370', f: '📄' },
  wave: { id: '5911484439505936397', f: '👋' },
} as const;

type EKey = keyof typeof E;

function pe(key: EKey): string {
  const e = E[key];
  return `<tg-emoji emoji-id="${e.id}">${e.f}</tg-emoji>`;
}

function stripPremium(html: string) {
  return html.replace(/<tg-emoji emoji-id="[^"]*">([^<]*)<\/tg-emoji>/g, '$1');
}

function fmtMoney(micros: number | bigint): string {
  const n = Number(micros) / 1e6;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRate(rate: string | number): string {
  const n = Number(rate);
  if (!Number.isFinite(n)) return String(rate);
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function orderStatusRu(status: string): string {
  const map: Record<string, string> = {
    draft: 'Черновик',
    awaiting_funds: 'Ожидание средств',
    locked: 'Заблокирована',
    processing: 'В обработке',
    awaiting_payout: 'Ожидание выплаты',
    completed: 'Завершена',
    cancelled: 'Отменена',
    rejected: 'Отклонена',
    failed: 'Ошибка',
    expired: 'Истекла',
  };
  return map[status] || status;
}

function shortOrderId(id: string): string {
  return id.slice(-8).toUpperCase();
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
  return new InlineKeyboard()
    .text(`${E.check.f} Принимаю правила`, 'rules:accept')
    .icon(E.check.id);
}

function openAppButton(kb: InlineKeyboard, label = `${E.house.f} Открыть приложение`) {
  kb.webApp(label, webappUrl).icon(E.house.id).primary();
  return kb;
}

function mainMenuKeyboard(admin: boolean) {
  const kb = new InlineKeyboard();
  openAppButton(kb);
  kb.row()
    .text(`${E.user.f} Профиль`, 'menu:profile')
    .icon(E.user.id)
    .text(`${E.support.f} Поддержка`, 'menu:support')
    .icon(E.support.id);
  if (admin) {
    kb.row().text(`${E.megaphone.f} Админ · рассылка`, 'admin:broadcast').icon(E.megaphone.id);
  }
  return kb;
}

function replyMenuKeyboard(admin: boolean) {
  const kb = new Keyboard()
    .webApp(`${E.house.f} Открыть приложение`, webappUrl)
    .icon(E.house.id)
    .primary()
    .row()
    .text(`${E.user.f} Профиль`)
    .icon(E.user.id)
    .text(`${E.support.f} Поддержка`)
    .icon(E.support.id);
  if (admin) kb.row().text(`${E.megaphone.f} Рассылка`).icon(E.megaphone.id);
  return kb.resized().persistent();
}

function profileActionsKeyboard() {
  return new InlineKeyboard()
    .text(`${E.swap.f} Курс`, 'menu:rate')
    .icon(E.swap.id)
    .text(`${E.folder.f} Заявки`, 'menu:orders')
    .icon(E.folder.id);
}

async function showMainMenu(ctx: Context) {
  const s = await settings();
  const welcome = s?.welcomeText || 'Добро пожаловать в Exchange.';
  const admin = isAdminTg(ctx);

  // 1) Premium menu emoji + reply keyboard (📱 = UTF-16 length 2)
  try {
    await ctx.reply(E.menu.f, {
      entities: [
        {
          type: 'custom_emoji',
          offset: 0,
          length: 2,
          custom_emoji_id: E.menu.id,
        },
      ],
      reply_markup: replyMenuKeyboard(admin),
    });
  } catch {
    await ctx.reply(E.menu.f, { reply_markup: replyMenuKeyboard(admin) });
  }

  // 2) Main menu with inline buttons
  await replyHtml(ctx, `${pe('star')} <b>${welcome}</b>`, {
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

async function showProfile(ctx: Context, edit = false) {
  const user = await ensureUser(ctx);
  if (!user) return;

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
  const bal = fmtMoney(available?.balance || 0);
  const refBal = fmtMoney(referral?.balance || 0);

  const text =
    `${pe('question')} <b>Информация</b>\n` +
    `├ Никнейм: ${nick}\n` +
    `├ ID: <code>${user.telegramId.toString()}</code>\n` +
    `╰ Кол-во сделок: ${deals}\n\n` +
    `${pe('question')} <b>Финансы</b>\n` +
    `├ Баланс: ${pe('dollar')} ${bal}\n` +
    `╰ Реферальный баланс: ${pe('dollar')} ${refBal}`;

  if (edit) {
    await editHtml(ctx, text, { reply_markup: profileActionsKeyboard() });
  } else {
    await replyHtml(ctx, text, { reply_markup: profileActionsKeyboard() });
  }
}

async function showRate(ctx: Context, edit = false) {
  const s = await settings();
  const rate = fmtRate(s?.usdtRubRate || process.env.DEFAULT_USDT_RUB_RATE || '98.01');
  const text =
    `${pe('swap')} <b>Курс обмена</b>\n\n` +
    `${pe('usdt')} 1 USDT = ${pe('rub')} <b>${rate}</b>`;

  const kb = new InlineKeyboard()
    .text(`${E.down.f} Назад`, 'menu:profile')
    .icon(E.down.id);

  if (edit) await editHtml(ctx, text, { reply_markup: kb });
  else await replyHtml(ctx, text, { reply_markup: kb });
}

async function showOrdersList(ctx: Context, edit = false) {
  const user = await ensureUser(ctx);
  if (!user) return;

  const orders = await prisma.exchangeOrder.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (!orders.length) {
    const empty =
      `${pe('folder')} <b>Заявки</b>\n\n` + `${pe('info')} У вас пока нет заявок.`;
    const kb = new InlineKeyboard()
      .text(`${E.down.f} Назад`, 'menu:profile')
      .icon(E.down.id);
    if (edit) await editHtml(ctx, empty, { reply_markup: kb });
    else await replyHtml(ctx, empty, { reply_markup: kb });
    return;
  }

  const kb = new InlineKeyboard();
  for (const o of orders) {
    const usdt = fmtMoney(o.fromAmountMicros);
    const label = `${shortOrderId(o.id)} · ${usdt} USDT · ${orderStatusRu(o.status)}`;
    kb.text(label, `order:${o.id}`).row();
  }
  kb.text(`${E.down.f} Назад`, 'menu:profile').icon(E.down.id);

  const text = `${pe('folder')} <b>Ваши заявки</b>\n\n${pe('pin')} Выберите заявку:`;
  if (edit) await editHtml(ctx, text, { reply_markup: kb });
  else await replyHtml(ctx, text, { reply_markup: kb });
}

async function showOrderDetail(ctx: Context, orderId: string) {
  const user = await ensureUser(ctx);
  if (!user) return;

  const order = await prisma.exchangeOrder.findFirst({
    where: { id: orderId, userId: user.id },
  });
  if (!order) {
    await editHtml(
      ctx,
      `${pe('warn')} Заявка не найдена.`,
      {
        reply_markup: new InlineKeyboard()
          .text(`${E.down.f} Назад`, 'menu:orders')
          .icon(E.down.id),
      },
    );
    return;
  }

  const usdt = fmtMoney(order.fromAmountMicros);
  const rub = (Number(order.toAmountKopecks) / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const created = order.createdAt.toLocaleString('ru-RU');

  const text =
    `${pe('folder')} <b>Заявка #${shortOrderId(order.id)}</b>\n\n` +
    `${pe('info')} Статус: <b>${orderStatusRu(order.status)}</b>\n` +
    `${pe('usdt')} Отдаёте: <b>${usdt} USDT</b>\n` +
    `${pe('rub')} Получаете: <b>${rub} ₽</b>\n` +
    `${pe('swap')} Курс: <b>${fmtRate(order.rate)}</b>\n` +
    `${pe('clock')} Создана: ${created}`;

  await editHtml(ctx, text, {
    reply_markup: new InlineKeyboard()
      .text(`${E.down.f} Назад`, 'menu:orders')
      .icon(E.down.id),
  });
}

async function showSupport(ctx: Context) {
  const s = await settings();
  const support = s?.supportUrl ? `\n\n${pe('link')} ${s.supportUrl}` : '';
  await replyHtml(
    ctx,
    `${pe('support')} <b>Поддержка</b>\n\n` +
      `По всем вопросам обращайтесь к оператору.\n` +
      `Укажите номер заявки при обращении.` +
      support,
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
    await showProfile(ctx, true);
  });

  bot.callbackQuery('menu:rate', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRate(ctx, true);
  });

  bot.callbackQuery('menu:orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showOrdersList(ctx, true);
  });

  bot.callbackQuery(/^order:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderId = ctx.match![1];
    await showOrderDetail(ctx, orderId);
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
        `${pe('star')} Доставлено: <b>${ok}</b>\n` +
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
    await replyHtml(ctx, `${pe('house')} Exchange`, { reply_markup: kb });
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
              .icon(E.check.id)
              .text(`${E.cross.f} Отмена`, 'admin:bc:cancel')
              .icon(E.cross.id),
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
      await replyHtml(ctx, `${pe('house')} Exchange`, { reply_markup: kb });
      return;
    }
    if (text.includes('Профиль') || text.includes('Баланс')) {
      await showProfile(ctx, false);
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
