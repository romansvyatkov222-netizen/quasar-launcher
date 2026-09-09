import { Router, type Request as ExpressRequest } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config.js';
import { prisma } from '../db.js';
import { asyncRoute } from '../utils/asyncRoute.js';
import { HttpError } from '../utils/errors.js';
import { authLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,16}$/, 'Ник: 3-16 символов, латиница/цифры/_'),
  password: z.string().min(8, 'Пароль минимум 8 символов').max(128),
});

function signToken(userId: string, username: string): { token: string; expiresAt: Date } {
  const token = jwt.sign({ sub: userId, username }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
  const decoded = jwt.decode(token) as { exp?: number } | null;
  // exp из подписанного токена — единственный источник истины по сроку сессии
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 12 * 3600 * 1000);
  return { token, expiresAt };
}

authRouter.post(
  '/register',
  authLimiter,
  asyncRoute(async (req, res) => {
    const { username, password } = credentialsSchema.parse(req.body);

    const exists = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (exists) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'Этот ник уже занят');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { username, passwordHash }, select: { id: true, username: true } });

    console.log(`[auth] зарегистрирован: ${username}`);
    res.status(201).json({ message: 'Аккаунт создан', user });
  }),
);

function requireAuthForYgg(req: ExpressRequest): { id: string; username: string } {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'MISSING_TOKEN', 'Требуется Authorization: Bearer <token>');
  }
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub?: string; username?: string };
    if (!payload.sub || !payload.username) throw new Error('bad payload');
    return { id: payload.sub, username: payload.username };
  } catch {
    throw new HttpError(401, 'INVALID_TOKEN', 'Токен невалиден или истёк');
  }
}

/**
 * Выдача игрового Yggdrasil-токена (accessToken для authlib-injector).
 * Вызывается лаунчером (Bearer JWT) при запуске игры; refresh ротирует токен.
 */
authRouter.post(
  '/yggdrasil-token',
  asyncRoute(async (req, res) => {
    const user = requireAuthForYgg(req);

    // одна активная игровая сессия на пользователя
    await prisma.yggToken.deleteMany({ where: { userId: user.id } });
    const accessToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + env.YGG_TOKEN_TTL_HOURS * 3600 * 1000);
    await prisma.yggToken.create({ data: { accessToken, userId: user.id, expiresAt } });

    // профиль: офлайн-UUID v3 (совместим с offline-mode; совпадает с Rust-ядром)
    const md5 = crypto.createHash('md5').update(`OfflinePlayer:${user.username}`, 'utf8').digest();
    md5[6] = (md5[6] & 0x0f) | 0x30;
    md5[8] = (md5[8] & 0x3f) | 0x80;
    const hex = md5.toString('hex');
    const profileId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

    res.json({
      accessToken,
      expiresAt: expiresAt.toISOString(),
      profile: { id: profileId.replace(/-/g, ''), name: user.username },
    });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncRoute(async (req, res) => {
    const { username, password } = credentialsSchema.parse(req.body);
    // clientHash присылает Rust-ядро; пустая строка = клиент без проверки (dev)
    const clientHash = z.string().max(64).optional().default('').parse(req.body.clientHash ?? '');

    if (env.CLIENT_HASH && clientHash !== env.CLIENT_HASH) {
      throw new HttpError(403, 'CLIENT_MISMATCH', 'Запуск разрешён только из официального лаунчера');
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Неверный ник или пароль');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Неверный ник или пароль');
    }

    const { token, expiresAt } = signToken(user.id, user.username);

    // одна активная сессия на пользователя: перезаписываем
    await prisma.session.upsert({
      where: { userId: user.id },
      update: { token, expiresAt, clientHash },
      create: { userId: user.id, token, expiresAt, clientHash },
    });

    res.json({
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, username: user.username },
    });
  }),
);
