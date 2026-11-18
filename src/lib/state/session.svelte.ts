/**
 * Sitzung: Entsperren, Datenbestand im Speicher, Autosave und Auto-Sperre.
 */
import { unlockDelayMs, WrongPassphraseError } from '../crypto/crypto';
import { todayIso } from '../domain/dates';
import { createEmptyDataset } from '../domain/defaults';
import {
  addAttachment,
  orphanBlobIds,
  pruneAttachmentMeta,
  removeAttachment,
} from '../domain/attachments';
import { uuidv7 } from '../domain/ids';
import { materializeDue } from '../domain/recurring';
import { processImage } from '../ui/image';
import { updateSnapshots } from '../domain/snapshots';
import type { Dataset, Id, Language, Theme } from '../domain/types';
import { i18n } from '../i18n/index.svelte';
import { readEncryptedBackup } from '../storage/backup';
import { dateStamp, downloadText } from '../storage/download';
import { EncryptedIndexedDbRepository } from '../storage/encrypted-idb';
import { MetaStore } from '../storage/meta';
import type { Repository } from '../storage/repository';

export type Status = 'loading' | 'setup' | 'locked' | 'unlocked';
export type UnlockResult = 'ok' | 'wrong' | 'wait';

const SAVE_DEBOUNCE_MS = 500;
const BACKGROUND_LOCK_MS = 60_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export class Session {
  status = $state<Status>('loading');
  /** Klartext-Datenbestand – nur im entsperrten Zustand vorhanden. */
  data = $state<Dataset | null>(null);
  saveState = $state<'idle' | 'pending' | 'saving' | 'error'>('idle');
  saveError = $state<string | null>(null);
  failedAttempts = $state(0);
  lockedUntil = $state(0);
  theme = $state<Theme>('system');
  /** Einrichtung läuft (erste Sicherung noch nicht bestätigt). */
  onboarding = $state(false);
  /** Kurze Statusmeldung (Toast). */
  toast = $state<string | null>(null);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savePromise: Promise<void> | null = null;
  private hiddenAt: number | null = null;
  private backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = Date.now();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly repo: Repository = new EncryptedIndexedDbRepository(),
    private readonly meta: MetaStore = new MetaStore(),
  ) {}

  async init(): Promise<void> {
    const prefs = await this.meta.get('prefs');
    const browserLang: Language = navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'de';
    i18n.set(prefs?.language ?? browserLang);
    this.applyTheme(prefs?.theme ?? 'system');
    const unlock = await this.meta.get('unlock');
    this.failedAttempts = unlock?.failedAttempts ?? 0;
    this.lockedUntil = unlock?.lockedUntil ?? 0;
    this.status = (await this.repo.isInitialized()) ? 'locked' : 'setup';
  }

  // ---------- Einrichten / Entsperren ----------

  async create(passphrase: string): Promise<void> {
    const d = createEmptyDataset(i18n.lang);
    d.settings.theme = this.theme;
    await this.repo.create(passphrase, d);
    this.onboarding = true;
    this.data = d;
    this.status = 'unlocked';
    this.startAutoLock();
  }

  /** Neuer Tresor aus einer `.finanz`-Sicherung (z. B. auf einem neuen Gerät). */
  async restore(fileText: string, passphrase: string): Promise<void> {
    const { dataset, attachments } = await readEncryptedBackup(fileText, passphrase);
    await this.repo.create(passphrase, dataset);
    await this.repo.replaceAll(dataset, attachments);
    this.adoptPrefs(dataset);
    this.data = dataset;
    this.status = 'unlocked';
    this.startAutoLock();
  }

  remainingWaitMs(now = Date.now()): number {
    return Math.max(0, this.lockedUntil - now);
  }

  async unlock(passphrase: string): Promise<UnlockResult> {
    if (this.remainingWaitMs() > 0) return 'wait';
    try {
      const d = await this.repo.unlock(passphrase);
      this.failedAttempts = 0;
      this.lockedUntil = 0;
      await this.meta.set('unlock', { failedAttempts: 0, lockedUntil: 0 });
      this.adoptPrefs(d);
      this.data = d;
      this.status = 'unlocked';
      this.startAutoLock();
      this.runDueTasks();
      void this.cleanupAttachments();
      return 'ok';
    } catch (e) {
      if (!(e instanceof WrongPassphraseError)) throw e;
      this.failedAttempts += 1;
      this.lockedUntil = Date.now() + unlockDelayMs(this.failedAttempts);
      await this.meta.set('unlock', {
        failedAttempts: this.failedAttempts,
        lockedUntil: this.lockedUntil,
      });
      return 'wrong';
    }
  }

  /** Speichert ausstehende Änderungen und entfernt Schlüssel und Klartext aus dem Speicher. */
  async lock(): Promise<void> {
    if (this.status !== 'unlocked') return;
    try {
      await this.flush();
    } finally {
      this.stopAutoLock();
      this.repo.lock();
      this.data = null;
      this.status = 'locked';
    }
  }

  async wipe(): Promise<void> {
    this.stopAutoLock();
    this.cancelSave();
    await this.repo.destroy();
    this.data = null;
    this.failedAttempts = 0;
    this.lockedUntil = 0;
    this.status = 'setup';
  }

  async changePassphrase(current: string, next: string): Promise<void> {
    const d = this.requireData();
    await this.flush();
    await this.repo.changePassphrase(current, next, $state.snapshot(d) as Dataset);
  }

  // ---------- Daten ändern und speichern ----------

  requireData(): Dataset {
    if (!this.data) throw new Error('Locked');
    return this.data;
  }

  /** Führt eine Änderung am Datenbestand aus und plant das Speichern. */
  mutate<T>(fn: (d: Dataset) => T): T {
    const result = fn(this.requireData());
    this.scheduleSave();
    return result;
  }

  /** Ersetzt den gesamten Datenbestand (Import, Demo-Daten). */
  async replaceData(d: Dataset, attachments = new Map<Id, Uint8Array<ArrayBuffer>>()) {
    this.cancelSave();
    updateSnapshots(d, todayIso());
    await this.repo.replaceAll(d, attachments);
    this.adoptPrefs(d);
    this.data = d;
  }

  private lastDueRun = '';

  /** Bucht fällige wiederkehrende Buchungen (einmal pro Tag bzw. nach dem Entsperren). */
  runDueTasks(): void {
    const today = todayIso();
    if (!this.data) return;
    this.lastDueRun = today;
    const n = materializeDue(this.data, today);
    if (n > 0) {
      this.scheduleSave();
      this.showToast(i18n.t('rec.booked', { n }));
    }
  }

  scheduleSave(): void {
    this.saveState = 'pending';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
  }

  private cancelSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.saveState === 'pending') this.saveState = 'idle';
  }

  /** Speichert sofort, falls Änderungen ausstehen. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    } else if (this.saveState !== 'pending') {
      await this.savePromise;
      return;
    }
    const d = this.data;
    if (!d || !this.repo.isUnlocked()) return;
    this.saveState = 'saving';
    updateSnapshots(d, todayIso());
    const snapshot = $state.snapshot(d) as Dataset;
    this.savePromise = this.repo
      .save(snapshot)
      .then(() => {
        if (this.saveState === 'saving') this.saveState = 'idle';
        this.saveError = null;
      })
      .catch((e: unknown) => {
        this.saveState = 'error';
        this.saveError = e instanceof Error ? e.message : String(e);
      });
    await this.savePromise;
  }

  // ---------- Belege ----------

  /** Verkleinert, verschlüsselt und speichert ein Foto für eine Buchung. */
  async addPhoto(transactionId: Id, file: Blob): Promise<void> {
    const img = await processImage(file);
    const id = uuidv7();
    await this.repo.putAttachment(id, img.bytes);
    // Die Buchung existiert evtl. noch nicht (neue Buchung): Metadaten trotzdem anlegen.
    this.mutate((d) =>
      addAttachment(d, { id, transactionId, mime: img.mime, size: img.bytes.byteLength }),
    );
  }

  /** Entschlüsselt einen Beleg und gibt eine Blob-URL zurück (Aufrufer gibt sie frei). */
  async attachmentUrl(id: Id): Promise<string | null> {
    const meta = this.data?.attachments.find((a) => a.id === id);
    const bytes = await this.repo.getAttachment(id);
    if (!bytes) return null;
    return URL.createObjectURL(new Blob([bytes], { type: meta?.mime ?? 'image/jpeg' }));
  }

  async removePhoto(id: Id): Promise<void> {
    this.mutate((d) => removeAttachment(d, id));
    await this.repo.deleteAttachment(id);
  }

  /** Entfernt verwaiste Belege (z. B. nach Löschen einer Buchung). */
  async cleanupAttachments(): Promise<void> {
    if (!this.data || !this.repo.isUnlocked()) return;
    const prunedMeta = pruneAttachmentMeta(this.data);
    const stored = await this.repo.listAttachmentIds();
    const orphans = orphanBlobIds(this.data, stored);
    for (const id of orphans) await this.repo.deleteAttachment(id);
    if (prunedMeta.length) this.scheduleSave();
  }

  // ---------- Sicherung ----------

  async downloadBackup(): Promise<void> {
    const d = this.requireData();
    d.settings.lastBackupAt = new Date().toISOString();
    // Erst sicher speichern, dann herunterladen – so geht der Vermerk nicht verloren.
    this.saveState = 'pending';
    await this.flush();
    const file = await this.repo.exportBackup($state.snapshot(d) as Dataset);
    downloadText(`finanzplaner-${dateStamp()}.finanz`, file, 'application/octet-stream');
  }

  // ---------- Darstellung ----------

  setTheme(theme: Theme): void {
    this.applyTheme(theme);
    if (this.data) this.mutate((d) => (d.settings.theme = theme));
    void this.meta.set('prefs', { language: i18n.lang, theme });
  }

  setLanguage(lang: Language): void {
    i18n.set(lang);
    if (this.data) this.mutate((d) => (d.settings.language = lang));
    void this.meta.set('prefs', { language: lang, theme: this.theme });
  }

  private adoptPrefs(d: Dataset): void {
    i18n.set(d.settings.language);
    this.applyTheme(d.settings.theme);
    void this.meta.set('prefs', { language: d.settings.language, theme: d.settings.theme });
  }

  private applyTheme(theme: Theme): void {
    this.theme = theme;
    if (typeof document === 'undefined') return;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }

  showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), 2500);
  }

  // ---------- Auto-Sperre ----------

  private onActivity = (): void => {
    this.lastActivity = Date.now();
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      void this.flush();
      this.backgroundTimer = setTimeout(() => void this.lock(), BACKGROUND_LOCK_MS);
    } else {
      if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
      this.backgroundTimer = null;
      // Timer im Hintergrund können gedrosselt sein → Zeit selbst prüfen.
      if (this.hiddenAt !== null && Date.now() - this.hiddenAt >= BACKGROUND_LOCK_MS) {
        void this.lock();
      }
      this.hiddenAt = null;
      this.lastActivity = Date.now();
    }
  };

  private onPageHide = (): void => {
    void this.flush();
  };

  private checkIdle = (): void => {
    if (this.lastDueRun !== todayIso()) this.runDueTasks();
    const minutes = this.data?.settings.autoLockMinutes ?? 10;
    if (minutes > 0 && Date.now() - this.lastActivity >= minutes * 60_000) void this.lock();
  };

  private startAutoLock(): void {
    this.stopAutoLock();
    this.lastActivity = Date.now();
    if (typeof window === 'undefined') return;
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, this.onActivity, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.idleTimer = setInterval(this.checkIdle, 15_000);
  }

  private stopAutoLock(): void {
    if (typeof window === 'undefined') return;
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, this.onActivity, { capture: true });
    }
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
    this.idleTimer = null;
    this.backgroundTimer = null;
    this.hiddenAt = null;
  }
}

export const session = new Session();

/** Zuletzt verwendetes Konto für die Schnelleingabe (nur im Speicher). */
export const lastUsed: { accountId?: string } = {};
