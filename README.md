# Finanzplaner

Ein persönlicher Finanzplaner, der **komplett im Browser** läuft. Es gibt keinen Server, kein Konto und kein Tracking. Alle Daten liegen **verschlüsselt auf deinem Gerät**. Gehostet wird die App über GitHub Pages.

- Oberfläche auf Deutsch und Englisch, Standardwährung CHF (`1'234.50`)
- Mobile-first, gleichberechtigt auf Handy und Laptop nutzbar
- Hell/Dunkel nach Systemeinstellung, manuell umschaltbar

## Das Puffer-Modell in Kürze

Alles Einkommen fliesst in einen **Puffer**. Am Monatsersten bucht die App ein festes **Selbst-Gehalt S** vom Puffer ins **Monatsbudget**. Daraus bezahlst du alles, auch Fixkosten und Rücklagen. Was über das Puffer-Ziel hinausgeht, kann auf Sparziele verteilt werden.

| Grösse                  | Formel                                          |
| ----------------------- | ----------------------------------------------- |
| Vorschlag Selbst-Gehalt | S = (1 − q) × Ē₁₂                               |
| Puffer-Ziel             | P_Ziel = N × S                                  |
| Reichweite              | R = P / S (Monate)                              |
| Überlauf                | Ü = max(0, P − P_Ziel), verteilt nach Gewichten |
| Rücklage pro Monat      | r = (B − A) / n, auf Rappen aufgerundet         |

Konten (echtes Geld) und Töpfe (virtuelle Zuteilung) sind zwei Ebenen. Es gilt immer:
**Summe der budgetrelevanten Konten = Summe aller Töpfe.** Eine Abweichung erscheint als «nicht zugeordnet».

## Sicherheitsmodell in einfachen Worten

- Beim ersten Start legst du eine **Passphrase** fest. Daraus wird mit PBKDF2-SHA-256 (600'000 Iterationen) ein AES-256-Schlüssel abgeleitet. Der Schlüssel lebt nur im Arbeitsspeicher.
- Gespeichert wird **nur Verschlüsseltes** (AES-GCM, bei jedem Speichern ein neuer IV).
- Die App sperrt sich nach 10 Minuten Inaktivität (einstellbar) und nach 60 Sekunden im Hintergrund.
- **Es gibt keine Wiederherstellung.** Wer die Passphrase vergisst, verliert die Daten. Deshalb erzwingt die App beim Einrichten eine erste verschlüsselte Sicherung (`.finanz`).
- Der Code ist öffentlich, deine Daten nicht. Details: [docs/SECURITY.md](docs/SECURITY.md).

> ⚠️ Lege niemals echte Finanzdaten, Exporte (`*.finanz`, `finanzplaner-*.json/csv`) oder Schlüssel in dieses Repository. Die `.gitignore` blockiert die üblichen Dateinamen, ersetzt aber keine Vorsicht.

## Lokal starten

Voraussetzung: Node.js 22.

```bash
npm install
```

```bash
npm run dev
```

Die App läuft dann unter http://localhost:5173. Im Entwicklungsmodus gibt es unter _Einstellungen → Entwicklung_ einen Knopf für **Demo-Daten** (frei erfunden), damit sich das Dashboard testen lässt. Im Produktions-Build fehlt dieser Knopf.

## Testen

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run check
```

```bash
npm run test:e2e
```

`npm test` führt die Unit-Tests (Vitest) für Formeln, Invariante, Buchungen, Krypto und Speicher aus. `npm run test:e2e` baut die App und führt den Playwright-Smoke-Test aus (einrichten, Buchung erfassen, sperren, entsperren). Beim ersten Mal braucht Playwright einen Browser:

```bash
npx playwright install chromium
```

## Bauen

```bash
npm run build
```

Das Ergebnis liegt in `dist/`. Der Basis-Pfad ist `/<REPO-NAME>/`. Er wird aus `BASE_PATH` oder `GITHUB_REPOSITORY` abgeleitet, sonst gilt `/finance/`.

```bash
npm run preview
```

## Deploy auf GitHub Pages

1. Im Repository unter **Settings → Pages → Source** die Option **GitHub Actions** wählen.
2. Auf `main` pushen (bzw. einen Pull Request mergen). Der Workflow `.github/workflows/deploy.yml` führt Lint, Typprüfung, Tests und Build aus und veröffentlicht `dist/`.
3. Pull Requests prüft `.github/workflows/ci.yml`.

**Empfohlen:** Unter _Settings → Branches_ eine Schutzregel für `main` anlegen (keine direkten Pushes, Pull Request und grüner CI-Lauf erforderlich). Begründung siehe [docs/SECURITY.md](docs/SECURITY.md).

## Projektstruktur

```
src/lib/domain/   reine Logik (Puffer, Budget, Invariante, Statistik) – vollständig getestet
src/lib/crypto/   Web-Crypto-Hilfen (PBKDF2, AES-GCM)
src/lib/storage/  Repository-Interface, verschlüsselter IndexedDB-Speicher, Migrationen, Export
src/lib/state/    Sitzung: Entsperren, Autosave, Auto-Sperre
src/routes/       Seiten der App
tests/            Unit-Tests, Fixtures (nur erfundene Daten), Playwright
docs/             SECURITY.md, DECISIONS.md
```

Der Speicher steckt hinter dem Interface `Repository`. Ein späteres `HttpRepository` (z. B. für ein eigenes Backend auf einem Raspberry Pi) lässt sich einsetzen, ohne die UI anzufassen.

## Funktionen

- **Buchungen:** Schnelleingabe am Handy, Aufteilen auf mehrere Kategorien, Umbuchungen, geteilte Kosten über Personenkonten, Suche und Filter
- **Puffer & Budget:** Selbst-Gehalt mit Anlaufphase, Monatsbudget pro Kategorie, Sparziele, Rücklagen mit automatischem Monatsbeitrag, Überlauf-Verteilung
- **Bank-Import:** CSV mit frei konfigurierbarer Spaltenzuordnung (Profile speicherbar) und camt.053 (ISO 20022), Vorschau, Duplikaterkennung
- **Auto-Regeln:** «Text enthält … → Kategorie», Vorschläge aus deinen bisherigen Zuordnungen
- **Fixkosten & Abos:** wiederkehrende Buchungen, Abo-Liste mit Jahreskosten und nächster Fälligkeit, automatische Buchung bei Fälligkeit
- **Monatsabschluss in 7 Schritten:** unkategorisierte Buchungen, Bankabgleich, offene Salden bei Personen, Reste, Selbst-Gehalt, Überlauf, Bericht und Sperre
- **Dashboard:** Reichweite des Puffers, Restbudget, Ausgaben nach Kategorie, Einnahmen vs. Ausgaben, Sparquote, Jahresübersicht
- **PWA:** installierbar und vollständig offline nutzbar
- **Export/Import:** verschlüsselte Sicherung (`.finanz`), Klartext-JSON/CSV nach Bestätigung

## Stand

Phase 1 (MVP) und Phase 2 (Alltag) sind umgesetzt. Phase 3 (Komfort) und 4 (Vermögen) folgen.

## Installieren (PWA)

- **Android/Chrome:** Menü → «App installieren».
- **iPhone/Safari:** Teilen → «Zum Home-Bildschirm».
- **Desktop/Chrome oder Edge:** Installieren-Symbol in der Adressleiste.

Die Daten liegen pro Browser bzw. installierter App getrennt. Zum Umziehen auf ein anderes Gerät: Sicherung herunterladen und dort «Aus Sicherung wiederherstellen».
