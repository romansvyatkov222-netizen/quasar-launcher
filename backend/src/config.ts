import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть минимум 32 символа'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CLIENT_HASH: z.string().optional(),
  CORS_ORIGIN: z.string().default('*'),
  // Публичный корень API (для Yggdrasil: подписи certificates, URL текстур).
  // Должен ТОЧНО совпадать с тем, что передаётся в -javaagent:authlib-injector.jar=...
  PUBLIC_API_ROOT: z.string().default('http://139.100.234.146:3000'),
  // Срок жизни игрового accessToken
  YGG_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(24),
  // Обновления лаунчера: приватный репо + fine-grained токен (Contents: Read)
  GITHUB_REPO: z.string().default('romansvyatkov222-netizen/quasar-launcher'),
  GITHUB_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] Некорректные переменные окружения:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
