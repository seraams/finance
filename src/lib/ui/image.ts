import { fitWithin, MAX_IMAGE_EDGE } from '../domain/attachments';

export interface ProcessedImage {
  bytes: Uint8Array<ArrayBuffer>;
  mime: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Verkleinert ein Foto auf max. 1600 px (längste Kante) und kodiert es als
 * WebP (Fallback JPEG). Durch das Neu-Kodieren gehen EXIF-Metadaten wie
 * GPS-Koordinaten verloren – gewollt.
 */
export async function processImage(file: Blob, max = MAX_IMAGE_EDGE): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let blob = await toBlob(canvas, 'image/webp', 0.8);
  let mime: ProcessedImage['mime'] = 'image/webp';
  if (!blob || blob.type !== 'image/webp') {
    // z. B. Safari kann kein WebP kodieren
    blob = await toBlob(canvas, 'image/jpeg', 0.82);
    mime = 'image/jpeg';
  }
  if (!blob) throw new Error('Encoding failed');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width, height };
}
