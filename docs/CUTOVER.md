# Umschalten von next.rahlwes.eu auf rahlwes.eu

Reihenfolge einhalten. Jeder Schritt nennt, woran man erkennt, dass er erledigt ist.
`npm run verify:origin` prüft den Stand gegen eine laufende Adresse; es verschickt keine Mails.

## Vor dem Umschalten (alles noch auf next.rahlwes.eu)

1. Die Pläne 001, 002 und 006 sind eingespielt und `npm run verify:origin -- https://next.rahlwes.eu staging` endet mit Exit 0.
2. `TURNSTILE_SECRET_KEY` (Worker-Secret) und `PUBLIC_TURNSTILE_SITEKEY` (`.env`, vor dem Build) sind gesetzt; das Kontaktformular wurde einmal von Hand abgeschickt und die Mail kam an. Prüfen: `npx wrangler secret list`.
3. Die Rechte am Nachgefragt-Video und an den Untertiteln sind mit dem Historischen Museum Frankfurt geklärt.
4. In Cloudflare Web Analytics ist der Hostname `rahlwes.eu` hinzugefügt (das Token ist an Hostnamen gebunden).
5. Keystatic-GitHub-App: Homepage-URL und Callback-URLs für `https://rahlwes.eu/…` ergänzt (siehe `.env.example`, Zeilen 11–12). Ohne das funktioniert die Anmeldung auf der neuen Adresse nicht.
6. Turnstile-Widget in Cloudflare um den Hostnamen `rahlwes.eu` erweitert.
7. Keine Testadresse auf `@example.com` verwenden; solche Adressen bouncen und schaden dem Absenderruf (AGENTS.md).

## Umschalten (ein Commit)

8. `astro.config.mjs`, Zeile 44: `site: 'https://rahlwes.eu'`. Das schaltet zugleich `noindex` aus und `robots.txt` auf `Allow` (`src/layouts/DefaultLayout.astro` Zeile 56, `src/pages/robots.txt.ts` Zeile 9).
9. `src/newsletter/email.ts`, Zeile 12: `SITE_ORIGIN = 'https://rahlwes.eu'`. Daraus entstehen Bestätigungs-, Abmelde- und `List-Unsubscribe`-Links in jeder Mail.
10. `wrangler.jsonc`, Zeile 70: Route `rahlwes.eu` als Custom Domain. **Achtung:** das löst die Domain von Squarespace. Vorher die bestehenden DNS-Einträge sichern.
11. `.github/workflows/scrape-cfps.yml`, Zeile 69: neue Adresse für `/api/cfps/notify`.
12. `npm run deploy` (nicht `wrangler deploy`, siehe README „Analytics“).
13. `npm run verify:origin -- https://rahlwes.eu production` muss mit Exit 0 enden. **Bleibt etwas rot, nicht freigeben.**

## Nach dem Umschalten

14. Google Search Console: Domain-Property `rahlwes.eu` anlegen, `https://rahlwes.eu/sitemap-index.xml` einreichen, die alte `sitemap.xml` entfernen.
15. Bing Webmaster Tools: Sitemap einreichen.
16. Mit einer eigenen Adresse den Newsletter abonnieren und prüfen, dass der Bestätigungslink auf `rahlwes.eu` zeigt (`SITE_ORIGIN`).
17. README und REDAKTION.md: `next.rahlwes.eu` durch `rahlwes.eu` ersetzen; ebenso `.env.example` (Zeilen 11–12) und die User-Agent-Texte in `src/ankai/lib/http.ts` (Zeile 3) und `scripts/scrape-cfps.mjs` (Zeile 17).
18. RSS-Abonnenten der alten Seite verlieren den Feed (`/journal?format=rss` liefert danach HTML). Entscheidung des Betreibers: keine RSS-Ausgabe.

`next.rahlwes.eu` danach abschalten oder per 301 auf `rahlwes.eu` leiten. Solange der Host nicht
`rahlwes.eu` heißt, bleibt er `noindex` und `Disallow`, also nie neben der Produktion indexierbar.
