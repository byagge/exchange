import { z } from 'zod';

export const authTelegramSchema = z.object({
  initData: z.string().min(1),
  referralCode: z.string().optional(),
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const depositCryptoBotSchema = z.object({
  checkUrl: z
    .string()
    .trim()
    .min(12)
    .max(500)
    .refine((u) => {
      try {
        const url = new URL(u.startsWith('http') ? u : `https://${u}`);
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        if (!['t.me', 'telegram.me'].includes(host)) return false;
        const path = url.pathname.toLowerCase();
        // Чеки @send / CryptoBot
        return (
          path.includes('/send') ||
          path.includes('/cryptobot') ||
          url.searchParams.has('start') ||
          url.searchParams.has('startapp')
        );
      } catch {
        return false;
      }
    }, 'Укажите ссылку на чек CryptoBot / @send (t.me/send?start=...)'),
});

const fioSchema = z
  .string()
  .trim()
  .min(3, 'Укажите ФИО')
  .max(120)
  .refine((v) => /[а-яА-ЯёЁa-zA-Z]/.test(v), 'Некорректное ФИО');

const bankSchema = z.string().trim().min(2, 'Укажите банк').max(80);

/** Только USDT → RUB. Банк и ФИО обязательны. */
export const createExchangeSchema = z
  .object({
    direction: z.literal('sell').default('sell'),
    amountUsdt: z.union([z.string(), z.number()]),
    pair: z.literal('USDT_RUB').optional(),
    method: z.literal('fiat').default('fiat'),
    requisites: z.object({
      type: z.enum(['sbp', 'card']).default('sbp'),
      phone: z.string().optional(),
      card: z.string().optional(),
      bank: bankSchema,
      fio: fioSchema,
      comment: z.string().max(200).optional(),
    }),
  })
  .superRefine((data, ctx) => {
    const req = data.requisites;
    if (req.type === 'sbp') {
      const phone = (req.phone || '').replace(/\D/g, '');
      if (phone.length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Укажите номер телефона СБП',
          path: ['requisites', 'phone'],
        });
      }
    } else {
      const card = (req.card || '').replace(/\D/g, '');
      if (card.length < 13) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Укажите номер карты',
          path: ['requisites', 'card'],
        });
      }
    }
  });

/** Оператор направляет клиенту сумму и таймер выплаты */
export const dispatchOrderSchema = z.object({
  amountRub: z.union([z.string(), z.number()]).optional(),
  timerMinutes: z.union([z.string(), z.number()]).default(30),
  note: z.string().max(500).optional(),
});

export const createWithdrawSchema = z
  .object({
    amountUsdt: z.union([z.string(), z.number()]),
    method: z.enum(['cryptobot', 'onchain']),
    username: z.string().optional(),
    address: z.string().optional(),
    network: z.enum(['TON', 'TRC20']).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === 'cryptobot') {
      const u = (data.username || '').trim().replace(/^@/, '');
      if (u.length < 3 || !/^[A-Za-z0-9_]{3,64}$/.test(u)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Укажите корректный Telegram username для чека КБ',
          path: ['username'],
        });
      }
    } else {
      const addr = (data.address || '').trim();
      if (data.network === 'TRC20') {
        if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Некорректный TRC20-адрес',
            path: ['address'],
          });
        }
      } else if (data.network === 'TON') {
        if (!(addr.startsWith('UQ') || addr.startsWith('EQ') || addr.startsWith('0:')) || addr.length < 48) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Некорректный TON-адрес',
            path: ['address'],
          });
        }
      } else {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Укажите сеть',
          path: ['network'],
        });
      }
    }
  });

export const adminUserUpdateSchema = z.object({
  status: z.enum(['active', 'banned', 'frozen']).optional(),
  notes: z.string().optional(),
  minDepositUsdt: z.number().nullable().optional(),
  maxWithdrawUsdt: z.number().nullable().optional(),
  minWithdrawUsdt: z.number().nullable().optional(),
  withdrawFrozen: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  firstName: z.string().optional(),
  username: z.string().optional(),
});

export const adminWalletWithdrawSchema = z.object({
  toAddress: z.string().min(8).optional(),
  amountUsdt: z.union([z.string(), z.number()]).optional(),
});

export const adminCreateUserSchema = z.object({
  telegramId: z.union([z.string(), z.number()]),
  username: z.string().optional(),
  firstName: z.string().optional(),
});

export const adminAdjustBalanceSchema = z.object({
  amountUsdt: z.union([z.string(), z.number()]),
  direction: z.enum(['credit', 'debit']),
  reason: z.string().min(2).max(200).default('admin_adjust'),
});

export const adminSettingsSchema = z.object({
  usdtRubRate: z.string().optional(),
  sweepThresholdUsdt: z.number().optional(),
  masterTonAddress: z.string().optional(),
  masterTrc20Address: z.string().optional(),
  minDepositUsdt: z.number().optional(),
  minWithdrawUsdt: z.number().optional(),
  withdrawFeeUsdt: z.number().optional(),
  exchangeFeePercent: z.number().optional(),
  supportUrl: z.string().optional(),
  welcomeText: z.string().max(2000).optional(),
  rulesText: z.string().max(4000).optional(),
  maintenanceMode: z.boolean().optional(),
  referralPercent: z.number().optional(),
  fiatReceivePhone: z.string().optional(),
  fiatReceiveCard: z.string().optional(),
  fiatReceiveBank: z.string().optional(),
  fiatReceiveName: z.string().optional(),
  defaultPayoutMinutes: z.number().int().min(1).max(24 * 60).optional(),
});

export const fulfillOrderSchema = z.object({
  proof: z.string().optional(),
  note: z.string().optional(),
});

export const rejectOrderSchema = z.object({
  reason: z.string().min(2),
});

export const adminCompleteWithdrawSchema = z.object({
  checkUrl: z.string().url().optional(),
  txHash: z.string().min(8).max(128).optional(),
  note: z.string().max(300).optional(),
});

export const adminBroadcastSchema = z.object({
  text: z.string().trim().min(2).max(4000),
  parseMode: z.enum(['HTML', 'Markdown']).optional(),
});
