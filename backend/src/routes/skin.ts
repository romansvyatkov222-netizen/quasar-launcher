import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncRoute } from '../utils/asyncRoute.js';
import { HttpError } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { skinLimiter } from '../middleware/rateLimit.js';
import { normalizeSkin } from '../utils/skin.js';

export const skinRouter = Router();

const MODEL_TYPES = ['slim', 'classic'] as const;
type ModelType = (typeof MODEL_TYPES)[number];

const uploadSchema = z.object({
  // base64 PNG (без data: префикса)
  image: z.string().min(100).max(600_000),
  modelType: z.enum(MODEL_TYPES).default('classic'),
});

/** Загрузка скина. Требует JWT. Скин читает Rust-ядро и шлёт base64. */
skinRouter.post(
  '/skin/upload',
  requireAuth,
  skinLimiter,
  asyncRoute(async (req, res) => {
    const { image, modelType } = uploadSchema.parse(req.body);
    const userId = req.user!.id;

    const input = Buffer.from(image, 'base64');
    const { png, resolution } = await normalizeSkin(input);
    const textureHash = crypto.createHash('sha256').update(png).digest('hex');

    const skin = await prisma.skin.upsert({
      where: { userId },
      update: { imageData: png, textureHash, resolution, modelType: modelType.toUpperCase() as 'SLIM' | 'CLASSIC' },
      create: { userId, imageData: png, textureHash, resolution, modelType: modelType.toUpperCase() as 'SLIM' | 'CLASSIC' },
    });

    res.json({
      message: 'Скин загружен',
      resolution: skin.resolution,
      modelType: skin.modelType.toLowerCase(),
    });
  }),
);

/** Отдача скина: PNG-байты (для Paper-плагина) или JSON+base64 (для лаунчера). */
skinRouter.get(
  '/skin/:userId',
  asyncRoute(async (req, res) => {
    const { userId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new HttpError(400, 'BAD_USER_ID', 'Некорректный userId');
    }

    const skin = await prisma.skin.findUnique({ where: { userId } });
    if (!skin) {
      throw new HttpError(404, 'SKIN_NOT_FOUND', 'Скин не найден');
    }

    const format = String(req.query.format ?? 'json').toLowerCase();
    if (format === 'png') {
      res
        .status(200)
        .type('image/png')
        .set('Cache-Control', 'public, max-age=60')
        .send(Buffer.from(skin.imageData));
      return;
    }

    res.set('Cache-Control', 'public, max-age=60').json({
      userId,
      resolution: skin.resolution,
      modelType: skin.modelType.toLowerCase() as ModelType,
      image: Buffer.from(skin.imageData).toString('base64'),
    });
  }),
);

/** Профиль игрока для Paper-плагина: метаданные без байтов. */
skinRouter.get(
  '/skin/:userId/metadata',
  asyncRoute(async (req, res) => {
    const skin = await prisma.skin.findUnique({
      where: { userId: req.params.userId },
      select: { resolution: true, modelType: true },
    });
    if (!skin) {
      throw new HttpError(404, 'SKIN_NOT_FOUND', 'Скин не найден');
    }
    res.json({ userId: req.params.userId, resolution: skin.resolution, modelType: skin.modelType.toLowerCase() });
  }),
);
