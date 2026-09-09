import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from '../config.js';
import { HttpError } from '../utils/errors.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Роут не существует' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: err.flatten().fieldErrors });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'CONFLICT', message: 'Запись уже существует' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Запись не найдена' });
      return;
    }
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'BAD_JSON', message: 'Некорректный JSON в теле запроса' });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: env.NODE_ENV === 'development' ? String(err) : 'Внутренняя ошибка сервера',
  });
}
