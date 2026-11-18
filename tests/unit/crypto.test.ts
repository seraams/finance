import { describe, expect, it } from 'vitest';
import {
  decryptBytes,
  decryptJson,
  deriveKey,
  encryptJson,
  newKdfParams,
  passphraseStrength,
  PBKDF2_ITERATIONS,
  unlockDelayMs,
  WrongPassphraseError,
} from '../../src/lib/crypto/crypto';

const FAST = 1000; // Tests: weniger Iterationen

describe('Verschlüsselung', () => {
  it('uses at least 600k PBKDF2 iterations by default', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(newKdfParams().iterations).toBe(PBKDF2_ITERATIONS);
  });

  it('round-trips JSON', async () => {
    const kdf = newKdfParams(FAST);
    const key = await deriveKey('korrekt pferd batterie heftklammer', kdf);
    const value = { a: 1, text: 'Grüezi – 1’234.50 CHF 💶' };
    const blob = await encryptJson(key, value);
    expect(blob.ciphertext).not.toContain('Grüezi');
    expect(await decryptJson(key, blob)).toEqual(value);
  });

  it('derives a non-extractable AES-GCM-256 key', async () => {
    const key = await deriveKey('secret passphrase', newKdfParams(FAST));
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('uses a fresh IV for each encryption', async () => {
    const key = await deriveKey('secret passphrase', newKdfParams(FAST));
    const a = await encryptJson(key, { x: 1 });
    const b = await encryptJson(key, { x: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails with the wrong passphrase', async () => {
    const kdf = newKdfParams(FAST);
    const key = await deriveKey('right passphrase', kdf);
    const blob = await encryptJson(key, { secret: true });
    const wrong = await deriveKey('wrong passphrase', kdf);
    await expect(decryptJson(wrong, blob)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('detects tampering', async () => {
    const key = await deriveKey('pw pw pw pw', newKdfParams(FAST));
    const blob = await encryptJson(key, { amount: 100 });
    const bytes = atob(blob.ciphertext);
    const flipped = String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1);
    await expect(decryptBytes(key, { ...blob, ciphertext: btoa(flipped) })).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it('different salts give different keys', async () => {
    const k1 = await deriveKey('same', newKdfParams(FAST));
    const blob = await encryptJson(k1, 1);
    const k2 = await deriveKey('same', newKdfParams(FAST));
    await expect(decryptJson(k2, blob)).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});

describe('Fehlversuche und Stärke', () => {
  it('grows the delay after 5 failed attempts', () => {
    expect(unlockDelayMs(4)).toBe(0);
    expect(unlockDelayMs(5)).toBe(30_000);
    expect(unlockDelayMs(6)).toBe(60_000);
    expect(unlockDelayMs(7)).toBe(120_000);
    expect(unlockDelayMs(50)).toBe(3_600_000);
  });

  it('rates passphrases', () => {
    expect(passphraseStrength('short')).toBe(0);
    expect(passphraseStrength('correct horse battery staple')).toBeGreaterThanOrEqual(3);
  });
});
