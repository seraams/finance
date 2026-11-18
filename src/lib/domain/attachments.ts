/**
 * Belege: Metadaten im Datenbestand, die (verschlüsselten) Bytes separat
 * im Repository.
 */
import type { AttachmentMeta, Dataset, Id } from './types';

export const MAX_IMAGE_EDGE = 1600;

/** Zielgrösse beim Verkleinern: längste Kante höchstens `max`, nie vergrössern. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function addAttachment(d: Dataset, meta: AttachmentMeta): void {
  d.attachments.push(meta);
  const tx = d.transactions.find((t) => t.id === meta.transactionId);
  if (tx && !tx.attachmentIds.includes(meta.id)) tx.attachmentIds.push(meta.id);
}

export function removeAttachment(d: Dataset, id: Id): void {
  d.attachments = d.attachments.filter((a) => a.id !== id);
  for (const t of d.transactions) {
    if (t.attachmentIds.includes(id)) t.attachmentIds = t.attachmentIds.filter((x) => x !== id);
  }
}

export function attachmentsOf(d: Dataset, txId: Id): AttachmentMeta[] {
  return d.attachments.filter((a) => a.transactionId === txId);
}

/** Entfernt Metadaten, deren Buchung nicht mehr existiert. Gibt die IDs zurück. */
export function pruneAttachmentMeta(d: Dataset): Id[] {
  const txIds = new Set(d.transactions.map((t) => t.id));
  const orphans = d.attachments.filter((a) => !txIds.has(a.transactionId)).map((a) => a.id);
  if (orphans.length) d.attachments = d.attachments.filter((a) => txIds.has(a.transactionId));
  return orphans;
}

/** IDs gespeicherter Bytes ohne Metadaten (z. B. abgebrochene Erfassung). */
export function orphanBlobIds(d: Dataset, storedIds: readonly Id[]): Id[] {
  const known = new Set(d.attachments.map((a) => a.id));
  return storedIds.filter((id) => !known.has(id));
}
