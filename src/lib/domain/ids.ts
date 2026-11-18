/**
 * UUIDv7 (RFC 9562): 48 Bit Unix-Zeit in ms, Version 7, 74 Bit Zufall.
 * Innerhalb derselben Millisekunde monoton steigend (Zähler im rand_a-Feld).
 */
let lastMs = -1;
let counter = 0;

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  if (now === lastMs) {
    counter = (counter + 1) & 0xfff;
  } else {
    lastMs = now;
    counter = ((bytes[6] ?? 0) << 4) & 0x7ff; // zufälliger Start, Platz für Inkremente
  }
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidV7(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
}
