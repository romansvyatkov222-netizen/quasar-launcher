import crypto from 'node:crypto';
import { prisma } from '../db.js';

/**
 * Ключевая пара Yggdrasil-сервера:
 *  - подпись свойств профиля (textures) — SHA1withRSA;
 *  - publicKeySignatureV2 для player certificates (chat signing).
 * Ключи стабильны: хранятся в settings и переживают рестарты
 * (смена ключей ломает кэши текстур и доверие клиентов).
 */
const KEY_SETTINGS_ID = 'signature_keypair';

let cached: { privateKeyPem: string; publicKeyPem: string; publicKeyDer: Buffer } | null = null;

export interface SignatureKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyDer: Buffer;
}

export async function getSignatureKeyPair(): Promise<SignatureKeyPair> {
  if (cached) return cached;

  const row = await prisma.setting.findUnique({ where: { key: KEY_SETTINGS_ID } });
  let privateKeyPem: string;
  if (row) {
    const parsed = JSON.parse(row.value) as { private: string; public: string };
    privateKeyPem = parsed.private;
  } else {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKeyPem = privateKey;
    await prisma.setting.upsert({
      where: { key: KEY_SETTINGS_ID },
      update: { value: JSON.stringify({ private: privateKey, public: publicKey }) },
      create: { key: KEY_SETTINGS_ID, value: JSON.stringify({ private: privateKey, public: publicKey }) },
    });
  }

  const keyObj = crypto.createPrivateKey(privateKeyPem);
  const publicKeyDer = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'der' });
  const publicKeyPem = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'pem' }).toString();

  cached = { privateKeyPem, publicKeyPem, publicKeyDer };
  return cached;
}

/** SHA1withRSA — подпись значений свойств профиля (textures и т.п.), Base64. */
export function signProperty(value: string): Promise<string> {
  return getSignatureKeyPair().then(({ privateKeyPem }) =>
    crypto.createSign('SHA1').update(value, 'utf8').sign(privateKeyPem, 'base64'),
  );
}

/** SHA256withRSA (Base64) — подпись для publicKeySignatureV2. */
function signV2(data: Buffer): Promise<string> {
  return getSignatureKeyPair().then(({ privateKeyPem }) =>
    crypto.createSign('SHA256').update(data).sign(privateKeyPem, 'base64'),
  );
}

// ---------- player certificates (chat signing, 1.19+) ----------

interface ProfileKey {
  privateKeyPem: string; // RSA 2048, PKCS#8
  publicKeyPem: string; // X.509 SPKI
  publicKeyDer: Buffer;
  publicKeySignatureV2: string; // Base64
  expiresAt: Date;
}

const KEY_TTL_MS = 18 * 3600 * 1000; // Mojang выдаёт на сутки; 18 ч с запасом
const profileKeys = new Map<string, ProfileKey>();

/**
 * Ключ подписи чата игрока. Формат ответа повторяет Mojang
 * POST /minecraftservices/player/certificates.
 *
 * publicKeySignatureV2 = SHA256withRSA(ключ Yggdrasil) над:
 *   apiRoot с завершающим "/" (UTF-8) || expiresAt (epoch-секунды, 8 байт BE)
 *   || publicKey (X.509 SPKI DER)
 * (раскладка из authlib-injector: агент проверяет подпись нашим
 * signaturePublickey, подставляя СВОЙ api root вместо Mojang-URL).
 */
export async function getPlayerCertificate(userId: string, apiRoot: string): Promise<{
  keyPair: { privateKey: string; publicKey: string };
  publicKeySignatureV2: string;
  expiresAt: string;
}> {
  const cachedKey = profileKeys.get(userId);
  if (cachedKey && cachedKey.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return formatCertificate(cachedKey);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const publicKeyDer = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  const expiresAt = new Date(Date.now() + KEY_TTL_MS);

  const epochSec = Buffer.alloc(8);
  epochSec.writeBigUInt64BE(BigInt(Math.floor(expiresAt.getTime() / 1000)));

  const rootWithSlash = apiRoot.endsWith('/') ? apiRoot : `${apiRoot}/`;
  const sigData = Buffer.concat([
    Buffer.from(rootWithSlash, 'utf8'),
    epochSec,
    publicKeyDer,
  ]);
  const publicKeySignatureV2 = await signV2(sigData);

  const cert: ProfileKey = { privateKeyPem: privateKey, publicKeyPem: publicKey, publicKeyDer, publicKeySignatureV2, expiresAt };
  profileKeys.set(userId, cert);
  return formatCertificate(cert);
}

function formatCertificate(cert: ProfileKey) {
  return {
    keyPair: { privateKey: cert.privateKeyPem, publicKey: cert.publicKeyPem },
    publicKeySignatureV2: cert.publicKeySignatureV2,
    expiresAt: cert.expiresAt.toISOString(),
  };
}
