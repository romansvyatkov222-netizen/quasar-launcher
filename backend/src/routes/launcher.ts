import { Router } from 'express';
import { asyncRoute } from '../utils/asyncRoute.js';
import { HttpError } from '../utils/errors.js';
import { launcherLimiter } from '../middleware/rateLimit.js';
import { env } from '../config.js';

/**
 * Раздача обновлений лаунчера через GitHub Releases (приватный репо).
 * GitHub-токен хранится ТОЛЬКО здесь (env), лаунчер ходит на наш API:
 *   GET /api/launcher/latest   -> { version, notes, size } | { version: null }
 *   GET /api/launcher/download -> стрим QuasarLauncher.exe
 */
export const launcherRouter = Router();

const GITHUB_API = 'https://api.github.com';
const ASSET_NAME = 'QuasarLauncher.exe';

interface GithubRelease {
  tag_name?: string;
  body?: string | null;
  assets?: {
    name?: string;
    size?: number;
    browser_download_url?: string;
  }[];
}

function githubHeaders(): Record<string, string> {
  if (!env.GITHUB_TOKEN) {
    throw new HttpError(503, 'UPDATER_NOT_CONFIGURED', 'Обновления не настроены на сервере');
  }
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'quasar-backend',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Свежий release; null — релизов нет / GitHub недоступен. */
async function fetchLatestRelease(): Promise<GithubRelease | null> {
  const resp = await fetch(`${GITHUB_API}/repos/${env.GITHUB_REPO}/releases/latest`, {
    headers: githubHeaders(),
  });
  if (resp.status === 404) return null; // релизов ещё не было — это не ошибка
  if (!resp.ok) {
    throw new HttpError(502, 'GITHUB_ERROR', `GitHub ответил ${resp.status}`);
  }
  return (await resp.json()) as GithubRelease;
}

launcherRouter.get(
  '/launcher/latest',
  launcherLimiter,
  asyncRoute(async (_req, res) => {
    const release = await fetchLatestRelease();
    if (!release?.tag_name) {
      res.json({ version: null });
      return;
    }
    // тег v0.2.0 -> 0.2.0
    const version = release.tag_name.replace(/^v/i, '');
    const asset = release.assets?.find((a) => a.name === ASSET_NAME);
    if (!asset?.browser_download_url) {
      res.json({ version: null });
      return;
    }
    res.json({
      version,
      notes: release.body ?? '',
      size: asset.size ?? 0,
    });
  }),
);

launcherRouter.get(
  '/launcher/download',
  launcherLimiter,
  asyncRoute(async (_req, res) => {
    const release = await fetchLatestRelease();
    const asset = release?.assets?.find((a) => a.name === ASSET_NAME);
    if (!asset?.browser_download_url) {
      throw new HttpError(404, 'NO_UPDATE', 'Обновление не найдено');
    }

    // Адрес конкретного asset: browser_download_url приватного репо
    // требует токен — качаем сами и стримим клиенту.
    const upstream = await fetch(asset.browser_download_url, { headers: githubHeaders() });
    if (!upstream.ok || !upstream.body) {
      throw new HttpError(502, 'GITHUB_ERROR', `Не удалось скачать релиз (${upstream.status})`);
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    if (asset.size) res.setHeader('Content-Length', String(asset.size));
    res.setHeader('Content-Disposition', `attachment; filename="${ASSET_NAME}"`);

    const reader = (upstream.body as unknown as {
      getReader(): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(): Promise<void>;
      };
    }).getReader();
    const abort = () => reader.cancel().catch(() => {});
    res.on('close', abort);
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      res.write(Buffer.from(value));
    }
    res.end();
  }),
);
