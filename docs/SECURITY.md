# Sicherheitsmodell

## Kurz gesagt

**Der Code ist öffentlich, die Daten nicht.** Die App läuft ohne Server. Deine Finanzdaten verlassen das Gerät nur, wenn du selbst eine Sicherung herunterlädst.

## Was die Verschlüsselung schützt

| Bedrohung                                                                | Schutz                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jemand bekommt das Gerät oder ein Backup des Browserprofils in die Hände | Ohne Passphrase sieht man nur verschlüsselte Daten (AES-GCM-256).                                                                                                                                                                                                                     |
| Jemand findet eine `.finanz`-Sicherung                                   | Sie ist mit derselben Passphrase verschlüsselt (gleiches Verfahren, Salt in der Datei).                                                                                                                                                                                               |
| Jemand rät die Passphrase                                                | PBKDF2-SHA-256 mit 600'000 Iterationen macht jeden Versuch teuer. Die App erzwingt nach 5 Fehlversuchen eine wachsende Wartezeit (30 s, 60 s, 120 s … bis 1 h). Diese Sperre schützt nur die Oberfläche; gegen Offline-Angriffe auf die Rohdaten hilft allein eine starke Passphrase. |
| Manipulierte Daten in IndexedDB                                          | AES-GCM ist authentifiziert: Veränderte Daten lassen sich nicht entschlüsseln.                                                                                                                                                                                                        |
| Gerät bleibt entsperrt liegen                                            | Auto-Sperre nach Inaktivität (Standard 10 Minuten) und 60 Sekunden nach dem Wechsel in den Hintergrund. Beim Sperren werden Schlüssel und Klartextdaten verworfen.                                                                                                                    |
| Skripte oder Anfragen von Dritten                                        | Keine CDNs, keine externen Schriften. Eine Content Security Policy (`default-src 'self'`, keine Inline-Skripte, `connect-src 'self'`) verhindert das Nachladen fremden Codes.                                                                                                         |

## Technische Details

- **Schlüsselableitung:** PBKDF2-SHA-256, 600'000 Iterationen, 16 Byte zufälliges Salt. Ergebnis: ein nicht exportierbarer AES-GCM-256-`CryptoKey`, nur im Arbeitsspeicher.
- **Verschlüsselung:** Der gesamte Datenbestand wird als JSON serialisiert und mit AES-GCM verschlüsselt (12 Byte zufälliger IV bei _jedem_ Speichern, feste Zusatzdaten `finanzplaner/v1`). Er liegt als ein Blob in IndexedDB. Belege werden einzeln verschlüsselt.
- **Falsche Passphrase** erkennt die App daran, dass die AES-GCM-Entschlüsselung fehlschlägt. Es wird kein Passwort-Hash gespeichert.
- **Passphrase ändern:** neues Salt, neuer Schlüssel, alles wird neu verschlüsselt und in einer Transaktion geschrieben.
- **Verwendet wird ausschliesslich die Web Crypto API**, keine eigene Kryptografie.

### Service Worker und Bankdateien

- Der Service Worker (PWA) cacht nur die gebauten App-Dateien. Daten gehen nie in den Cache.
- Importierte Bankdateien (CSV, camt.053) werden nur im Browser gelesen und nicht gespeichert. Gespeichert werden nur die daraus erzeugten Buchungen (verschlüsselt) und, falls gewünscht, das Importprofil (Spaltenzuordnung, ebenfalls verschlüsselt im Datenbestand).

### Was unverschlüsselt gespeichert wird

In IndexedDB (Store `meta`) liegen ohne Verschlüsselung:

- die gewählte Sprache und das Theme (damit der Sperrbildschirm richtig aussieht),
- der Fehlversuchszähler und der Zeitpunkt, bis zu dem nach Fehlversuchen gewartet werden muss.

Zusätzlich sichtbar sind die PBKDF2-Parameter (Salt, Iterationen) und die ungefähre Grösse des verschlüsselten Datenbestands. Finanzdaten liegen nie im Klartext in IndexedDB, im `localStorage` oder im Service-Worker-Cache.

## Was die Verschlüsselung NICHT schützt

- **Bösartiger Code im Repository.** Die App wird aus diesem öffentlichen Repository gebaut. Gelangt bösartiger Code hinein (z. B. über einen kompromittierten Account oder eine manipulierte Abhängigkeit), könnte er die Passphrase beim Eintippen abgreifen. Gegenmassnahmen:
  - Der Branch `main` ist vor direkten Pushes geschützt (Pull Request und grüner CI-Lauf erforderlich, einrichten unter _Settings → Branches_).
  - Abhängigkeiten sind über `package-lock.json` fixiert. CI installiert mit `npm ci`.
  - Zur Laufzeit wird kein Code von Dritten geladen (CSP).
  - Dependabot meldet Updates; jedes Update geht durch einen Pull Request.
- **Ein kompromittiertes Gerät** (Keylogger, bösartige Browser-Erweiterung, Schadsoftware) kann die Passphrase oder die entsperrten Daten mitlesen.
- **Während die App entsperrt ist**, liegen die Daten im Klartext im Arbeitsspeicher. JavaScript kann Speicher nicht gezielt löschen. Die App verwirft beim Sperren alle Verweise, die Freigabe übernimmt der Garbage Collector.
- **Klartext-Exporte** (JSON/CSV) sind unverschlüsselt. Die App verlangt dafür eine ausdrückliche Bestätigung.
- **Eine schwache Passphrase.** Verwende mehrere zufällige Wörter (mindestens 10 Zeichen, besser deutlich mehr).
- **Datenverlust.** Löscht der Browser die Website-Daten (z. B. «Verlauf löschen» oder Speicherdruck auf iOS), ist der lokale Bestand weg. Mache regelmässig verschlüsselte Sicherungen.

## Keine Wiederherstellung

Es gibt keine Hintertür und keinen Wiederherstellungsschlüssel. Wer die Passphrase vergisst, verliert die Daten. Deshalb erzwingt die App beim Einrichten eine erste Sicherung.

## Sicherheitslücken melden

Bitte keine öffentlichen Issues mit Details zu Sicherheitslücken eröffnen, sondern GitHubs «Report a vulnerability» (private Meldung) verwenden.
