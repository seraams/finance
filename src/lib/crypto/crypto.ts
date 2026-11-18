/**
 * Verschlüsselung mit der Web Crypto API – keine eigene Kryptografie.
 *
 * - Schlüsselableitung: PBKDF2-SHA-256, ≥ 600'000 Iterationen, 16 Byte Salt
 * - Verschlüsselung: AES-GCM-256, 12 Byte zufälliger IV pro Vorgang
 * - Der Schlüssel ist ein nicht exportierbarer `CryptoKey`.
 */

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
/** Zusätzliche authentifizierte Daten: bindet den Geheimtext an diese App. */
const AAD = new TextEncoder().encode('finanzplaner/v1');

export interface KdfParams {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  /** Base64 */
  salt: string;
}

export interface EncryptedBlob {
  /** Base64 */
  iv: string;
  /** Base64 */
  ciphertext: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase or corrupted data');
    this.name = 'WrongPassphraseError';
  }
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API not available (HTTPS required)');
  return globalThis.crypto.subtle;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function newKdfParams(iterations = PBKDF2_ITERATIONS): KdfParams {
  return { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(randomBytes(SALT_BYTES)) };
}

export async function deriveKey(passphrase: string, kdf: KdfParams): Promise<CryptoKey> {
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') throw new Error('Unsupported KDF');
  const baseKey = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(kdf.salt), iterations: kdf.iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // nicht exportierbar
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plaintext);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
}

export async function decryptBytes(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(blob.iv), additionalData: AAD },
      key,
      fromBase64(blob.ciphertext),
    );
    return new Uint8Array(pt);
  } catch {
    // AES-GCM schlägt bei falschem Schlüssel oder manipulierten Daten fehl.
    throw new WrongPassphraseError();
  }
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  return encryptBytes(key, new TextEncoder().encode(JSON.stringify(value)));
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  const bytes = await decryptBytes(key, blob);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Wartezeit nach Fehlversuchen beim Entsperren.
 * Die ersten 5 Versuche sind frei; danach 30 s, 60 s, 120 s … (max. 1 h).
 */
export function unlockDelayMs(failedAttempts: number): number {
  if (failedAttempts < 5) return 0;
  const exp = failedAttempts - 5;
  return Math.min(30_000 * 2 ** exp, 3_600_000);
}

/** Grobe Einschätzung der Passphrase-Stärke (0–4), ohne externe Bibliothek. */
export function passphraseStrength(p: string): number {
  if (p.length < 8) return 0;
  let classes = 0;
  if (/[a-z]/.test(p)) classes++;
  if (/[A-Z]/.test(p)) classes++;
  if (/[0-9]/.test(p)) classes++;
  if (/[^a-zA-Z0-9]/.test(p)) classes++;
  const words = p.trim().split(/\s+/).length;
  let score = 0;
  if (p.length >= 12) score++;
  if (p.length >= 16) score++;
  if (classes >= 3 || words >= 4) score++;
  if (p.length >= 20 && (classes >= 2 || words >= 4)) score++;
  return Math.min(4, score);
}

export const MIN_PASSPHRASE_LENGTH = 10;
