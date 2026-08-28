# Redaktions-Handbuch

Diese Seite läuft auf Cloudflare Workers. Inhalte liegen als Markdown-Dateien im
GitHub-Repository und werden über Keystatic bearbeitet – ein Editor, der aussieht
wie ein normales CMS, aber im Hintergrund Dateien speichert.

Deutsch ist die Ausgangssprache. Englisch und Französisch werden automatisch mit
DeepL übersetzt.

## Inhalte bearbeiten

1. `https://next.rahlwes.eu/keystatic` öffnen und mit GitHub anmelden.
2. Links die Sprache wählen (Deutsch / English / Français).
3. Eintrag bearbeiten und **Save** klicken.

Speichern schreibt einen Commit ins Repository. Die Seite baut sich danach
automatisch neu – nach etwa einer Minute ist die Änderung online.

### Was wo liegt

| Bereich | Was drin steht |
| --- | --- |
| **Startseite** | Überschrift, Einleitung, Leistungen, Über-mich-Blöcke, Stimmen |
| **Seiten** | Freie Seiten wie „Über mich“, „Impressum“, „Datenschutz“ |
| **Projekte** | Ausstellungsprojekte, digitale Vermittlung, pädagogisches Material |
| **Journal** | Blogartikel |

Ein Journal-Eintrag mit Häkchen bei **Entwurf** erscheint nicht auf der Seite.

## Texte mit Gemini schreiben

Gemini kennt das Format dieser Seite nicht. Damit der Text direkt passt, dieses
Briefing an den Anfang des Chats stellen:

> Du hilfst mir, Texte für meine Website als Historikerin zu schreiben.
> Antworte immer in Markdown, ohne HTML.
> Struktur: kurze Absätze, Zwischenüberschriften mit `##`, Listen mit `-`.
> Keine Überschrift mit `#` – der Titel wird separat gepflegt.
> Sprache: Deutsch, Sie-Form, sachlich und klar, keine Werbefloskeln.
> Gib mir zusätzlich einen Teaser von maximal zwei Sätzen.

Danach den Text aus Gemini kopieren und in Keystatic in das Feld **Inhalt**
einfügen. Der Teaser gehört in das Feld **Teaser**.

## Deutschen Text glätten (DeepL Write)

Für Grammatik und Formulierung – nicht für Übersetzungen:

```sh
npm run rephrase -- entwurf.md
```

Das Skript zeigt jede Änderung als Vorher/Nachher-Zeile an und schreibt
`entwurf.rephrased.md`. **Vorschläge immer durchlesen:** DeepL Write macht aus
knappen Sätzen gern ausformulierte Prosa, was bei Überschriften und
Bildbeschreibungen falsch ist.

## Übersetzen

Nachdem die deutschen Texte stehen:

```sh
npm run translate                  # alles nach EN und FR
npm run translate -- --only-missing # nur neue Dateien
npm run translate -- --locale fr    # nur Französisch
```

Übersetzt werden Titel, Teaser, Fließtext und die SEO-Felder. Datumsangaben,
Bildpfade und Kategorien bleiben unverändert. Ein erneuter Lauf überschreibt
vorhandene Übersetzungen – wer eine Übersetzung von Hand nachgebessert hat,
sollte `--only-missing` verwenden.

Übersetzungen dürfen anschließend in Keystatic unter *English* bzw. *Français*
frei nachbearbeitet werden.

## Bilder

Bilder direkt in Keystatic hochladen. Sie landen in `public/uploads/`. Der
**Alt-Text** ist Pflicht: er beschreibt das Bild für blinde Nutzerinnen und für
Google. Beispiel: „Zwei Ausstellungskataloge auf einem Tisch“ – nicht „Bild“.

## Lokal arbeiten

```sh
npm install
npm run dev     # http://localhost:4321, Editor unter /keystatic
npm run build   # Produktions-Build
```

Beim lokalen Start schreibt Keystatic direkt in die Dateien im Projektordner,
nicht nach GitHub.
