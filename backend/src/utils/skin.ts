import sharp from 'sharp';
import { HttpError } from './errors.js';

const ALLOWED_WIDTHS = new Set([64, 128, 256]);

export interface NormalizedSkin {
  png: Uint8Array<ArrayBuffer>;
  resolution: number;
}

/**
 * Валидирует скин через sharp и приводит его к квадратному PNG:
 *  - принимает 64x64 / 128x128 / 256x256;
 *  - принимает legacy 64x32 / 128x64 (нижняя половина дополняется прозрачным);
 *  - всё остальное — 400.
 */
/** Prisma Bytes требует Uint8Array с обычным ArrayBuffer (не SharedArrayBuffer). */
function toPrismaBytes(b: Uint8Array): Uint8Array<ArrayBuffer> {
  return b.buffer instanceof ArrayBuffer && b.byteOffset === 0
    ? (b as Uint8Array<ArrayBuffer>)
    : Uint8Array.from(b);
}

export async function normalizeSkin(input: Buffer): Promise<NormalizedSkin> {
  let width = 0;
  let height = 0;
  let format = '';

  try {
    const meta = await sharp(input).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    format = meta.format ?? '';
  } catch {
    throw new HttpError(400, 'INVALID_IMAGE', 'Не удалось прочитать изображение (нужен PNG)');
  }

  if (format !== 'png') {
    throw new HttpError(400, 'INVALID_FORMAT', `Поддерживается только PNG (получен ${format})`);
  }
  if (!ALLOWED_WIDTHS.has(width)) {
    throw new HttpError(400, 'BAD_RESOLUTION', `Ширина скина должна быть 64, 128 или 256 px (получена ${width})`);
  }

  try {
    if (height === width) {
      return { png: toPrismaBytes(await sharp(input).png().toBuffer()), resolution: width };
    }
    if (height === width / 2) {
      // legacy 64x32 (например, старый Steve) -> дополняем до квадрата прозрачным низом
      const png = await sharp({
        create: { width, height: width, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: await sharp(input).png().toBuffer(), top: 0, left: 0 }])
        .png()
        .toBuffer();
      return { png: toPrismaBytes(png), resolution: width };
    }
  } catch {
    throw new HttpError(500, 'SKIN_PROCESSING_FAILED', 'Ошибка обработки скина');
  }

  throw new HttpError(
    400,
    'BAD_RESOLUTION',
    `Высота скина должна равняться ширине или ширине/2 (получено ${width}x${height})`,
  );
}
