import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncRoute } from '../utils/asyncRoute.js';
import { HttpError } from '../utils/errors.js';
import { env } from '../config.js';
import { getSignatureKeyPair, signProperty, getPlayerCertificate } from '../utils/yggdrasil.js';
import { yggLimiter } from '../middleware/rateLimit.js';

/**
 * Yggdrasil-сервер (протокол authlib-injector):
 *  - join/hasJoined — верификация входа на этапе логина (online-mode=true);
 *  - профиль с подписанными textures — нативная раздача скинов;
 *  - refresh/validate/invalidate — управление токенами лаунчера;
 *  - player/certificates — ключи подписи чата (1.19+).
 *
 * Парольного входа через Yggdrasil НЕТ (authenticate -> 403):
 * получить игровой токен можно только через наш лаунчер (JWT + clientHash).
 */
export const yggdrasilRouter = Router();

const API_ROOT = env.PUBLIC_API_ROOT.replace(/\/$/, '');
const JOIN_TTL_MS = 30_000;

/** Java UUID.nameUUIDFromBytes("OfflinePlayer:" + name): MD5, version 3, RFC 4122 variant.
 *  Совпадает с offline_uuid() в Rust — данные игроков прежнего offline-mode сохраняются. */
function offlineUuid(username: string): string {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const unhex = (uuid: string) => uuid.replace(/-/g, '');

// ---------- join / hasJoined ----------

interface JoinRecord {
  accessToken: string;
  selectedProfile: string;
  username: string;
  userId: string;
  ip: string | null;
  expiresAt: number;
}
const joinRecords = new Map<string, JoinRecord>();

// периодическая чистка просроченных записей
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of joinRecords) if (v.expiresAt < now) joinRecords.delete(k);
}, 10_000).unref();

yggdrasilRouter.post(
  '/sessionserver/session/minecraft/join',
  yggLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const body = joinSchema.parse(req.body);
    const token = await prisma.yggToken.findUnique({ where: { accessToken: body.accessToken } });
    if (!token || token.expiresAt < new Date()) {
      throw new HttpError(403, 'ForbiddenOperationException', 'Invalid token.');
    }
    const user = await prisma.user.findUnique({ where: { id: token.userId } });
    if (!user || unhex(offlineUuid(user.username)) !== body.selectedProfile) {
      throw new HttpError(403, 'ForbiddenOperationException', 'Invalid token.');
    }

    const serverId = body.serverId;
    joinRecords.set(serverId, {
      accessToken: body.accessToken,
      selectedProfile: body.selectedProfile,
      username: user.username,
      userId: user.id,
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null,
      expiresAt: Date.now() + JOIN_TTL_MS,
    });
    res.status(204).end();
  }),
);

yggdrasilRouter.get(
  '/sessionserver/session/minecraft/hasJoined',
  asyncRoute(async (req: Request, res: Response) => {
    const username = String(req.query.username ?? '');
    const serverId = String(req.query.serverId ?? '');
    const record = joinRecords.get(serverId);
    if (!record || record.expiresAt < Date.now() || record.username !== username) {
      // спецификация: 204 No Content -> MC-сервер кикает на этапе логина
      res.status(204).end();
      return;
    }
    joinRecords.delete(serverId); // одноразовость

    const profile = await buildProfile(record.userId, true);
    res.json(profile);
  }),
);

// ---------- профиль ----------

interface SkinRow {
  userId: string;
  imageData: Uint8Array;
  textureHash: string | null;
  modelType: 'SLIM' | 'CLASSIC';
}

/** Свойство textures (Base64 JSON), URL — кэшируемый /api/texture/<sha256>. */
async function texturesProperty(skin: SkinRow, username: string, signed: boolean) {
  let hash = skin.textureHash;
  if (!hash) {
    hash = crypto.createHash('sha256').update(skin.imageData).digest('hex');
    await prisma.skin.update({ where: { userId: skin.userId }, data: { textureHash: hash } });
  }
  const payload = {
    timestamp: Date.now(),
    profileId: unhex(offlineUuid(username)),
    profileName: username,
    textures: {
      SKIN: {
        url: `${API_ROOT}/api/texture/${hash}.png`,
        metadata: { model: skin.modelType === 'SLIM' ? 'slim' : 'default' },
      },
    },
  };
  const value = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const prop: { name: string; value: string; signature?: string } = { name: 'textures', value };
  if (signed) prop.signature = await signProperty(value);
  return prop;
}

async function buildProfile(userId: string, signed: boolean) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { skin: true } });
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'Профиль не найден');
  const uuid = offlineUuid(user.username);
  const properties = [];
  if (user.skin) properties.push(await texturesProperty(user.skin, user.username, signed));
  return {
    id: unhex(uuid),
    name: user.username,
    ...(properties.length ? { properties } : {}),
  };
}

yggdrasilRouter.get(
  '/sessionserver/session/minecraft/profile/:uuid',
  asyncRoute(async (req: Request, res: Response) => {
    const unsigned = String(req.query.unsigned ?? 'true') !== 'false';
    const uuidHex = req.params.uuid.replace(/-/g, '').toLowerCase();
    const users = await prisma.user.findMany({
      where: { username: { in: await allUsernames() } },
      include: { skin: true },
    });
    const user = users.find((u) => unhex(offlineUuid(u.username)) === uuidHex);
    if (!user) {
      res.status(204).end();
      return;
    }
    const profile = await buildProfile(user.id, !unsigned);
    res.json(profile);
  }),
);

// кэш списка ников на 5 секунд (профиль-запросы редки)
let usernamesCache: { names: string[]; at: number } | null = null;
async function allUsernames(): Promise<string[]> {
  if (usernamesCache && Date.now() - usernamesCache.at < 5000) return usernamesCache.names;
  const users = await prisma.user.findMany({ select: { username: true } });
  const names = users.map((u) => u.username);
  usernamesCache = { names, at: Date.now() };
  return names;
}

yggdrasilRouter.post(
  '/api/profiles/minecraft',
  asyncRoute(async (req: Request, res: Response) => {
    const names = req.body;
    if (!Array.isArray(names) || names.length === 0 || names.length > 100) {
      throw new HttpError(400, 'IllegalArgumentException', 'profiles must be 1..100');
    }
    const users = await prisma.user.findMany({
      where: { username: { in: names.map(String) } },
      select: { username: true },
    });
    res.json(users.map((u) => ({ id: unhex(offlineUuid(u.username)), name: u.username })));
  }),
);

// ---------- authserver (токены) ----------

async function issueYggToken(userId: string): Promise<string> {
  const accessToken = crypto.randomBytes(32).toString('hex');
  await prisma.yggToken.create({
    data: { accessToken, userId, expiresAt: new Date(Date.now() + env.YGG_TOKEN_TTL_HOURS * 3600 * 1000) },
  });
  // лимит токенов на пользователя: старые удаляем при превышении
  const tokens = await prisma.yggToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: 10,
    select: { accessToken: true },
  });
  if (tokens.length) {
    await prisma.yggToken.deleteMany({ where: { accessToken: { in: tokens.map((t) => t.accessToken) } } });
  }
  return accessToken;
}

yggdrasilRouter.post(
  '/authserver/authenticate',
  asyncRoute(async (_req: Request, res: Response) => {
    // Парольный вход сквозь Yggdrasil закрыт: только Quasar Launcher
    res.status(403).json({
      error: 'ForbiddenOperationException',
      errorMessage: 'Вход только через Quasar Launcher.',
    });
  }),
);

yggdrasilRouter.post(
  '/authserver/refresh',
  asyncRoute(async (req: Request, res: Response) => {
    const { accessToken, clientToken } = refreshSchema.parse(req.body);
    const token = await prisma.yggToken.findUnique({ where: { accessToken } });
    if (!token || token.expiresAt < new Date()) {
      throw new HttpError(403, 'ForbiddenOperationException', 'Invalid token.');
    }
    await prisma.yggToken.delete({ where: { accessToken } }); // revoke старого
    const newToken = await issueYggToken(token.userId);
    const user = await prisma.user.findUnique({ where: { id: token.userId } });
    res.json({
      accessToken: newToken,
      ...(clientToken ? { clientToken } : {}),
      selectedProfile: user
        ? { id: unhex(offlineUuid(user.username)), name: user.username }
        : undefined,
    });
  }),
);

yggdrasilRouter.post(
  '/authserver/validate',
  asyncRoute(async (req: Request, res: Response) => {
    const { accessToken } = validateSchema.parse(req.body);
    const token = await prisma.yggToken.findUnique({ where: { accessToken } });
    if (!token || token.expiresAt < new Date()) {
      throw new HttpError(403, 'ForbiddenOperationException', 'Invalid token.');
    }
    res.status(204).end();
  }),
);

yggdrasilRouter.post(
  '/authserver/invalidate',
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = validateSchema.safeParse(req.body);
    if (parsed.success) {
      await prisma.yggToken.deleteMany({ where: { accessToken: parsed.data.accessToken } });
    }
    res.status(204).end();
  }),
);

// ---------- метаданные API (для authlib-injector) ----------

yggdrasilRouter.get('/', async (_req: Request, res: Response) => {
  const { publicKeyPem } = await getSignatureKeyPair();
  res.json({
    meta: {
      serverName: 'Quasar',
      implementationName: 'quasar-yggdrasil',
      implementationVersion: '1.0.0',
      feature: {
        non_email_login: false,
        enable_profile_key: true,
        username_check: true,
      },
    },
    // по правилам spec: точное совпадение домена; у нас голый IP без порта в домене
    skinDomains: ['139.100.234.146'],
    signaturePublickey: publicKeyPem,
  });
});

// ---------- player certificates (chat signing) ----------

yggdrasilRouter.post(
  '/minecraftservices/player/certificates',
  yggLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    // вызывается агентом/клиентом с Bearer <accessToken>
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ')) {
      throw new HttpError(401, 'Unauthorized', 'Missing bearer token');
    }
    const token = await prisma.yggToken.findUnique({ where: { accessToken: auth.slice(7) } });
    if (!token || token.expiresAt < new Date()) {
      throw new HttpError(403, 'ForbiddenOperationException', 'Invalid token.');
    }
    const cert = await getPlayerCertificate(token.userId, API_ROOT);
    res.json(cert);
  }),
);

// ---------- zod-схемы ----------

const hexUuid = z.string().regex(/^[0-9a-f]{32}$/i);
const joinSchema = z.object({
  accessToken: z.string().min(16).max(128),
  selectedProfile: hexUuid,
  serverId: z.string().min(1).max(128),
});
const refreshSchema = z.object({
  accessToken: z.string().min(16).max(128),
  clientToken: z.string().max(128).optional(),
  requestUser: z.boolean().optional(),
});
const validateSchema = z.object({
  accessToken: z.string().min(16).max(128),
  clientToken: z.string().max(128).optional(),
});
