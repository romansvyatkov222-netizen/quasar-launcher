// Разовый бэкфорд: для скинов без texture_hash вычисляем sha256(image_data).
// Запуск: node scripts/backfill-texture-hash.mjs
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const skins = await prisma.skin.findMany({ where: { textureHash: null } });
for (const skin of skins) {
  const hash = crypto.createHash('sha256').update(Buffer.from(skin.imageData)).digest('hex');
  await prisma.skin.update({ where: { id: skin.id }, data: { textureHash: hash } });
  console.log(`[backfill] skin ${skin.id}: ${hash.slice(0, 12)}...`);
}
console.log(`[backfill] готово, обновлено ${skins.length}`);
await prisma.$disconnect();
