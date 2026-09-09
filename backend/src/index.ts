import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config.js';
import { authRouter } from './routes/auth.js';
import { skinRouter } from './routes/skin.js';
import { modsRouter } from './routes/mods.js';
import { textureRouter } from './routes/texture.js';
import { launcherRouter } from './routes/launcher.js';
import { yggdrasilRouter } from './routes/yggdrasil.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/error.js';
import { ensureDatabase, runMigrations } from './ensureDb.js';

// Автосоздание БД + применение миграций (можно отключить AUTO_MIGRATE=false)
if (process.env.AUTO_MIGRATE !== 'false') {
  await ensureDatabase(env.DATABASE_URL);
  runMigrations();
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST'],
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use('/api', authRouter);
app.use('/api', skinRouter);
app.use('/api', modsRouter);
app.use('/api', launcherRouter);
app.use(textureRouter);

// Yggdrasil-сервер (authlib-injector): корень API, НЕ под /api
// (метаданные — GET /, join/hasJoined/profile, refresh/validate, certificates)
app.use(yggdrasilRouter);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`[quasar-backend] слушает http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
