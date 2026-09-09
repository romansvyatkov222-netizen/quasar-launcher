import { spawnSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Автосоздание БД: если база из DATABASE_URL не существует — создаём её,
 * подключившись к служебной БД "postgres" под тем же пользователем
 * (пользователь должен иметь право CREATEDB; на VDS это настроено при инициализации).
 */
export async function ensureDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName) throw new Error('DATABASE_URL не содержит имя базы данных');

  const admin = async (connectDb: string): Promise<Client> => {
    const u = new URL(databaseUrl);
    u.pathname = `/${connectDb}`;
    const client = new Client({ connectionString: u.toString() });
    await client.connect();
    return client;
  };

  let client: Client;
  try {
    client = await admin(dbName);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== '3D000') throw e; // 3D000 = database does not exist
    console.log(`[db-setup] БД "${dbName}" не существует — создаю`);
    const adminClient = await admin('postgres');
    try {
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[db-setup] БД "${dbName}" создана`);
    } finally {
      await adminClient.end();
    }
    client = await admin(dbName);
  }
  await client.end();
}

/** Применение миграций Prisma при старте (идемпотентно). */
export function runMigrations(): void {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const r = spawnSync(npx, ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`prisma migrate deploy завершился с кодом ${r.status}`);
  }
}
