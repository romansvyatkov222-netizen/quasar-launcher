import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../utils/errors.js';

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'MISSING_TOKEN', 'Требуется Authorization: Bearer <token>');
    }
    const token = header.slice(7);

    try {
      jwt.verify(token, env.JWT_SECRET);
    } catch {
      throw new HttpError(401, 'INVALID_TOKEN', 'Токен невалиден или истёк');
    }

    const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
    if (!session || session.expiresAt < new Date()) {
      throw new HttpError(401, 'SESSION_EXPIRED', 'Сессия не найдена или истекла');
    }

    req.user = { id: session.user.id, username: session.user.username };
    next();
  } catch (e) {
    next(e);
  }
}
