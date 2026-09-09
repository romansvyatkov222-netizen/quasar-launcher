import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncRoute } from '../utils/asyncRoute.js';

/**
 * Раздача текстур по хэшу: GET /api/texture/<sha256>.png
 * URL попадает в подписанное свойство textures профиля.
 * Спецификация Yggdrasil: Content-Type обязан быть image/png.
 */
export const textureRouter = Router();

textureRouter.get(
  '/api/texture/:hash',
  asyncRoute(async (req, res) => {
    const hash = String(req.params.hash).replace(/\.png$/i, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      res.status(404).end();
      return;
    }
    const skin = await prisma.skin.findFirst({ where: { textureHash: hash } });
    if (!skin) {
      res.status(404).end();
      return;
    }
    res
      .status(200)
      .type('image/png')
      .set('Cache-Control', 'public, max-age=604800, immutable')
      .send(Buffer.from(skin.imageData));
  }),
);
