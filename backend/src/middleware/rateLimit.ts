import { rateLimit } from 'express-rate-limit';

const body = (message: string) => ({ error: 'RATE_LIMITED', message });

/** Регистрация/логин: жёсткий лимит против брутфорса */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body('Слишком много попыток входа, попробуйте позже'),
});

/** /verify-token — вызывается Paper-плагином при каждом входе игрока */
export const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body('Слишком много запросов verify-token'),
});

/** Загрузка скинов */
export const skinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body('Слишком много загрузок скина, попробуйте позже'),
});

/** Yggdrasil: join/certificates — игрок при каждом входе в игру */
export const yggLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'ForbiddenOperationException', errorMessage: 'Too many requests.' },
});

/** Проверка/скачивание обновлений лаунчера */
export const launcherLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body('Слишком много запросов обновлений'),
});

/** Общий лимит на все /api-роуты */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: body('Превышен лимит запросов'),
});
