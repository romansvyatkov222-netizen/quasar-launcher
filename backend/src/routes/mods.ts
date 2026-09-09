import { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncRoute } from '../utils/asyncRoute.js';
import { HttpError } from '../utils/errors.js';

export const modsRouter = Router();

// cwd = корень backend (и в dev через tsx, и на VDS в systemd)
const FILES_DIR = path.resolve(process.cwd(), 'files');

/** Список модов для UI лаунчера (обязательные + опциональные с GitHub-ссылками). */
modsRouter.get(
  '/mods',
  asyncRoute(async (_req, res) => {
    const mods = await prisma.modManifest.findMany({
      orderBy: [{ modType: 'asc' }, { name: 'asc' }],
    });

    res.json({
      required: mods.filter((m) => m.modType === 'REQUIRED').map((m) => ({ ...m, modType: 'required' })),
      optional: mods.filter((m) => m.modType === 'OPTIONAL').map((m) => ({ ...m, modType: 'optional' })),
    });
  }),
);

/**
 * Эталонный манифест хэшей для Rust-ядра.
 * query: files=mods,libraries (по умолчанию только mods)
 * Ответ: [{ path, sha256, size? }]
 */
modsRouter.get(
  '/manifest',
  asyncRoute(async (req, res) => {
    const dirs = z
      .string()
      .default('mods')
      .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(z.enum(['mods', 'libraries'])))
      .parse(req.query.files);

    const entries: Array<{ path: string; sha256: string }> = [];
    if (dirs.includes('mods')) {
      // В манифест верификации входят ОБА типа: обязательные должен иметь каждый,
      // опциональные — только выбранные игроком (Rust сверяет по наличию в mods/)
      const mods = await prisma.modManifest.findMany({
        select: { fileName: true, sha256Hash: true },
      });
      for (const m of mods) entries.push({ path: `mods/${m.fileName}`, sha256: m.sha256Hash });
    }
    if (dirs.includes('libraries')) {
      // Библиотеки: если решишь хранить их эталоны в БД — добавь модель; пока отдаётся пустой список,
      // и Rust-ядро просто считает хэши библиотек без сверки (или сверяет только mods).
      // Чтобы включить строгую сверку libraries, добавь записи в отдельную таблицу.
    }

    res.json({ generatedAt: new Date().toISOString(), files: entries });
  }),
);

/**
 * Раздача собственных файлов (клиентский Fabric-мод).
 * Только имена без пути (защита от traversal), из backend/files/.
 */
modsRouter.get(
  '/files/:name',
  asyncRoute(async (req, res) => {
    const name = z.string().regex(/^[A-Za-z0-9._-]+$/).parse(req.params.name);
    const file = path.join(FILES_DIR, name);
    if (!file.startsWith(FILES_DIR) || !name.endsWith('.jar')) {
      throw new HttpError(400, 'BAD_FILE_NAME', 'Некорректное имя файла');
    }
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'FILE_NOT_FOUND', message: 'Файл не найден' });
      }
    });
  }),
);
