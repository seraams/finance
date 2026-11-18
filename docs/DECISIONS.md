# Entscheidungen

Kurz festgehaltene Entscheidungen, wo der Auftrag Spielraum liess.

## Phase 1

### D1 – Abgeleitete Topfeffekte statt gespeicherter Topfbewegungen

Einnahmen, Ausgaben und Umbuchungen über die Grenze budgetrelevant ↔ nicht budgetrelevant wirken auf Töpfe. Diese Wirkung wird **bei jeder Berechnung aus den Buchungen abgeleitet** (`src/lib/domain/balances.ts`) und nicht als `PotMove` gespeichert. So bleibt die Invariante auch nach dem Bearbeiten oder Löschen einer Buchung automatisch erfüllt. Gespeichert werden nur echte Umverteilungen (Selbst-Gehalt, Überlauf, manuelles Verschieben …).

Regeln:

- Anfangssaldo eines budgetrelevanten Kontos → Puffer.
- Einnahme-Split → Puffer (oder `potId`).
- Ausgabe-Split → Monatsbudget (oder `potId`, z. B. ein Sparziel).
- Umbuchung zwischen budgetrelevantem und nicht budgetrelevantem Konto (z. B. ins Depot) → `potId`, Standard Puffer.
- Nicht aufgeteilter Rest (unkategorisiert): Abfluss → Monatsbudget, Zufluss → Puffer.

«Nicht zugeordnet» entsteht damit nur noch durch Ereignisse wie das Löschen eines Topfs mit Saldo oder durch unausgeglichene manuelle Bewegungen. Die Übersicht bietet dann «Dem Puffer zuordnen» an.

### D2 – Umbuchungen als Buchungspaar

Eine Umbuchung besteht aus einer **Ursprungsbuchung** (`transferId === id`) und einer **gespiegelten Gegenbuchung** pro Gegenkonto-Split (`transferId` = ID des Ursprungs). Bearbeitet und gelöscht wird immer über den Ursprung; die Spiegel werden neu erzeugt. So haben beide Konten echte Buchungen (wichtig für den späteren Bank-Abgleich), und geteilte Kosten (30 CHF Ausgabe + 60 CHF Umbuchung auf den Mitbewohner) sind eine einzige Buchung mit zwei Splits.

### D3 – Anfangssaldo als Kontofeld

`Account` hat zusätzlich `openingBalance` und `openingDate`. Das ist einfacher als eine Pseudo-Buchung und taucht nicht in Statistiken auf.

### D4 – Standard-Budgetrelevanz

Nur Depot, Säule 3a und Krypto sind standardmässig nicht budgetrelevant (wie im Auftrag). Person und Schuld sind budgetrelevant; das lässt sich pro Konto ändern.

### D5 – Rundung des S-Vorschlags

Der Vorschlag S = (1 − q) × Ē₁₂ wird auf **ganze Franken abgerundet**. Ē₁₂ nutzt die abgeschlossenen Monate vor dem aktuellen (höchstens 12, ab dem ersten Monat mit Daten). Gibt es noch keinen abgeschlossenen Monat, wird der laufende Monat verwendet. q wird in Prozent gespeichert (`savingsRatePct`), um Gleitkommafehler zu vermeiden.

### D6 – Vorschlag für tieferes S

Bei Warnstufe gelb/rot schlägt die App das S vor, mit dem der aktuelle Puffer genau 2 Monate reicht: ⌊P / 2⌋ auf Franken, höchstens das aktuelle S.

### D7 – Überlauf-Rest

Jeder Anteil wird auf Rappen abgerundet; der Rest geht an das Ziel mit dem grössten Gewicht, bei Gleichstand an das erste in der Liste.

### D8 – Budgetmonat und Monatsbeginn

Alle Monatsauswertungen nutzen den **Budgetmonat** (Einstellung «Monatsbeginn», Tag 1–28). Beginnt der Monat am 25., gehört der 24. März zum Budgetmonat Februar.

### D9 – Monatsbudget-Topf in Phase 1

Ohne Monatsabschluss (kommt in Phase 2) bleiben Reste im Monatsbudget-Topf stehen und summieren sich. Die Restanzeige pro Kategorie folgt trotzdem der Einstellung `rolloverRest` (nur positive Reste werden übertragen, Überzüge nie). Das Zurückbuchen in den Puffer übernimmt der Monatsabschluss.

### D10 – Snapshots

Bei jedem Speichern werden Monats-Snapshots aller Konten ab dem Eröffnungsmonat geschrieben (Saldo am Ende des Budgetmonats, im laufenden Monat Stand heute). Snapshots nicht abgeschlossener Monate werden aktualisiert, abgeschlossene (`MonthClosing`) bleiben eingefroren.

### D11 – Unverschlüsselte Metadaten

Sprache, Theme und der Fehlversuchszähler liegen unverschlüsselt in IndexedDB (Store `meta`), weil sie vor dem Entsperren gebraucht werden. Sie enthalten keine Finanzdaten (siehe SECURITY.md).

### D12 – Wartezeit nach Fehlversuchen

Ab dem 5. Fehlversuch: 30 s, danach verdoppelt bis höchstens 1 Stunde. Zähler und Zeitpunkt werden gespeichert, damit ein Neuladen die Sperre nicht umgeht.

### D13 – Erste Sicherung

Nach dem Anlegen des Tresors kann man erst weiter, wenn die `.finanz`-Sicherung heruntergeladen wurde. Fehlt `settings.lastBackupAt` (z. B. nach einem Abbruch), erscheint der Schritt beim nächsten Entsperren erneut. Die Sicherung verwendet den aktuellen Schlüssel und das Salt des Tresors, lässt sich also mit derselben Passphrase öffnen, auch auf einem anderen Gerät («Aus Sicherung wiederherstellen»).

### D14 – CSP nur im Build

Die Content Security Policy wird per Vite-Plugin nur in den Produktions-Build eingefügt, weil der Dev-Server Styles inline einspeist. `connect-src` enthält bis Phase 4 nur `'self'`; die optionale Kurs-API wird erst mit dem Kursabruf ergänzt.

### D15 – Kein externes UI-Framework, Systemschriften

Für minimalen Code und strikte CSP: eigene Komponenten, Systemschriften, keine Icon-Fonts (Unicode-Zeichen als Symbole).

### D16 – Diagrammfarben

Einnahmen/Ausgaben nutzen ein mit einem Farbsehschwäche-Validator geprüftes Blau/Orange-Paar, je eigene Stufe für hell und dunkel. Ausgaben nach Kategorie werden als sortierte Balkenliste mit Beträgen gezeigt (eine Farbe, kein Kreisdiagramm), die Jahresübersicht als Tabelle.

### D17 – Passphrase-Mindestlänge

Mindestens 10 Zeichen; eine grobe Stärkeanzeige ohne externe Bibliothek.

### D18 – TypeScript 6

`typescript-eslint` und `svelte-check` unterstützen TypeScript 7 noch nicht; daher `typescript ~6.0`.

### D19 – Bekannte Audit-Meldung

`npm audit` meldet eine ReDoS-Lücke in `picomatch` (über `svelte-check`, `typescript-eslint`). Betroffen sind nur Entwicklungswerkzeuge mit Glob-Mustern aus dem Repo selbst, nicht die ausgelieferte App.
