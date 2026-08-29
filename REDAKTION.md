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

## Newsletter

Der Newsletter läuft vollständig auf dieser Seite – kein Mailchimp, keine
Fremdanbieter. Anmeldungen liegen in einer Cloudflare-Datenbank, der Versand
läuft über Cloudflare Email Sending.

### Anmeldung und Abmeldung

Leserinnen und Leser melden sich unter `/newsletter/` an (je Sprache eine Seite).
Sie bekommen zuerst eine Bestätigungsmail und stehen erst nach dem Klick auf den
Link auf der Liste – das ist gesetzlich vorgeschrieben (Double Opt-in).
**Unbestätigte Adressen bekommen nie eine E-Mail.**

Jede versendete Mail enthält unten einen Abmeldelink, zusätzlich den technischen
Abmelde-Header, den Gmail und Outlook als eigenen „Abbestellen“-Knopf anzeigen.
Abmelden löscht die Adresse sofort.

### Anmeldung über das Kontaktformular

Unter jedem Kontaktformular steht ein zweites, leeres Kästchen: „Ich möchte
zusätzlich den Newsletter erhalten.“ Wer es anhakt, bekommt dieselbe
Bestätigungsmail wie bei einer normalen Anmeldung und steht erst nach dem Klick auf
den Link auf der Liste.

Das Kästchen ist absichtlich nie vorausgefüllt und getrennt von der
Datenschutz-Zustimmung. Beides zusammenzulegen wäre rechtlich keine gültige
Einwilligung.

Wer bereits angemeldet ist, bekommt nichts doppelt: Die Anfrage wird einfach
ignoriert.

### Absenderadresse

Newsletter verschicken sich von **newsletter@marketing.rahlwes.eu**, das
Kontaktformular dagegen von `kontakt@send.rahlwes.eu`. Das ist Absicht: E-Mail-Anbieter
bewerten den Ruf einer Absenderdomain getrennt. Landet ein Newsletter einmal bei
vielen Empfängern im Spam, zieht das die Antworten aus dem Kontaktformular nicht mit
herunter.

### Newsletter schreiben

1. In Keystatic unter **Newsletter** einen Eintrag anlegen.
2. **Betreff** ist die Betreffzeile der E-Mail.
3. Den Text unter **Inhalt** schreiben – wie bei einem Journal-Beitrag.
4. **Status** steht zunächst auf *Entwurf*.

Solange der Status *Entwurf* ist, lässt sich der Newsletter nicht verschicken.

### Versenden

1. Status in Keystatic auf **Bereit zum Versand** setzen und speichern.
2. Etwa eine Minute warten, bis die Seite neu gebaut ist.
3. `https://next.rahlwes.eu/admin/newsletter/` öffnen (Anmeldung über GitHub,
   dieselbe wie bei Keystatic).
4. Mit **Vorschau** prüfen, wie der Text in der Mail aussieht.
5. **Versenden** klicken und bestätigen.

Der Versand geht ausschließlich an bestätigte Abonnenten und **lässt sich nicht
rückgängig machen**. Danach den Status in Keystatic auf *Versendet* setzen, damit
klar bleibt, was schon raus ist.

Die Mails werden in einer Warteschlange nacheinander verschickt; bei einer
größeren Liste dauert das ein paar Minuten. Ein zweiter Klick auf *Versenden*
verschickt den Newsletter erneut an alle – also nur einmal klicken.

### Sprache der Abonnenten

Jede Anmeldung merkt sich, welche Sprache der Browser des Lesers eingestellt hat.
Danach richtet sich, in welcher Sprache die E-Mails ankommen — wer mit französischem
Browser auf der deutschen Seite unterschreibt, bekommt französische Post.

In der Liste steht hinter der Sprache manchmal noch ein zweites Kürzel, etwa
`Deutsch pt-BR`. Das heißt: Diese Person liest eigentlich Portugiesisch, bekommt aber
Deutsch, weil es die Seite auf Portugiesisch nicht gibt. Tauchen solche Kürzel häufiger
auf, lohnt sich vielleicht eine weitere Sprache.

### Unzustellbare Adressen

Manche Adressen existieren irgendwann nicht mehr – das Postfach wurde gelöscht, die
Firma hat gewechselt. Solche Adressen erkennt das System selbst und markiert sie als
**unzustellbar**. Sie bekommen keine E-Mails mehr, bleiben aber in der Liste, damit
nachvollziehbar ist, warum jemand nichts mehr erhält.

Das passiert automatisch einmal pro Nacht. Vor einem Versand lässt sich der Abgleich
mit **Jetzt abgleichen** auch von Hand anstoßen.

Warum das wichtig ist: Wer dauerhaft an tote Adressen schickt, landet mit der Zeit
bei allen anderen im Spam-Ordner. Die Liste sauber zu halten schützt also die
Zustellung an alle übrigen Abonnenten.

**Reaktivieren** hebt die Markierung auf – sinnvoll etwa, wenn ein Postfach nur
vorübergehend voll war. War die Adresse dauerhaft nicht erreichbar, markiert der
nächste Abgleich sie wieder.

### Abonnenten verwalten

Unter `https://next.rahlwes.eu/admin/subscribers/`:

- Die Liste zeigt alle Adressen mit Status (*bestätigt* / *unbestätigt*).
- **Löschen** entfernt eine Adresse sofort.
- **Importieren** übernimmt eine bestehende Liste: Adressen durch Komma,
  Semikolon oder Zeilenumbruch trennen.

Importierte Adressen gelten sofort als bestätigt. Deshalb dort **nur Listen
einfügen, die dem Newsletter schon einmal ausdrücklich zugestimmt haben** – alles
andere ist rechtlich Spam und schadet der Zustellbarkeit.

## Bilder

Bilder direkt in Keystatic hochladen. Sie landen in `src/assets/uploads/` und
werden beim Build automatisch verkleinert und in WebP umgewandelt. Der
**Alt-Text** ist Pflicht: er beschreibt das Bild für blinde Nutzerinnen und für
Google. Beispiel: „Zwei Ausstellungskataloge auf einem Tisch“ – nicht „Bild“.

## Lokal arbeiten

```sh
npm install
npm run dev     # http://localhost:4321, Editor unter /keystatic
npm run build   # Produktions-Build
```

Der Editor arbeitet immer über GitHub – auch lokal. Speichern erzeugt also
immer einen Commit; es gibt keinen Modus, der nur lokale Dateien anfasst.
