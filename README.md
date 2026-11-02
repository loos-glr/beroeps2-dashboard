# BEROEPS2 · GitHub Flow Dashboard

Formatief dashboard voor het BEROEPS2-traject (Grafisch Lyceum Rotterdam). Het
dashboard leest publieke GitHub-activiteit (commits, pull requests, issues) van
de geconfigureerde teamrepo's en toont per student een status.

In de huidige frontend blijft alle configuratie (teams, studentnamen, token) **lokaal in de browser**
(localStorage). Er staan geen studenten, repo's of tokens in de code.

## Structuur

```
public/           Document root (Plesk: httpdocs/public)
  index.html      Markup en modals (geen inline CSS/JS)
  css/ js/ assets/  Frontend (ES-modules, zie hieronder)
  api/index.php   Centraal JSON API-entrypoint (+ .htaccess rewrite)
src/              PHP 8.3 classes (namespace App\): Config, Database, Auth, Http, Controllers, Services
sql/schema.sql    MariaDB-installatiescript
bin/ dev/         CLI-hulpscript (wachtwoordhash) en router voor `php -S`
.env.example      Configuratiesjabloon (kopieer naar .env)
```

De frontend werkt voorlopig nog volledig client-side (localStorage); de
backend (Stap 1) levert database, login-sessie en API-skelet.

Frontend-modules (`public/js/`):

| Module | Verantwoordelijkheid |
| --- | --- |
| `js/main.js` | Bootstrap, gedelegeerde events (`data-action`), laadlogica |
| `js/state.js` | Gedeelde app-state + render/reload-hooks |
| `js/cache.js` | Tweelaagse cache: teamdata met TTL + ETag/body per API-URL |
| `js/storage.js` | localStorage-sleutels, token en docentnaam |
| `js/utils.js` | Pure helpers: escaping, datums, iconen, templatefragmenten |
| `js/teams.js` | Teams beheren, teamnaam-modal, JSON import/export |
| `js/aliases.js` | Studentnamen koppelen en accounts ontdubbelen |
| `js/github.js` | GitHub API: rate limit, teamdata, collaborator-repo's |
| `js/analysis.js` | Profielen samenvoegen, totalen, statusbepaling |
| `js/dashboard.js` | KPI's, teamkaarten en studentrijen renderen |
| `js/detail.js` | Student-detailmodal (drill-down) |
| `js/modals.js` | Tokenmodal, overlay- en Escape-afhandeling |

## Lokaal draaien

ES-modules werken niet via `file://`. Start de PHP-server vanuit de projectmap
(het router-script zorgt dat `/api/...` zonder Apache werkt):

```bash
cp .env.example .env   # alleen nodig voor de API
php -S localhost:8000 -t public dev/router.php
# dashboard: http://localhost:8000  ·  API: http://localhost:8000/api/health
```

Alleen de frontend: `python3 -m http.server 8000 -d public`.

## Backend & Plesk-installatie

1. Domein op **PHP 8.3** zetten; document root → `httpdocs/public`, repo in `httpdocs`.
2. MariaDB-database + gebruiker aanmaken en `sql/schema.sql` importeren (phpMyAdmin).
3. `.env.example` kopiëren naar `.env` (buiten de document root) en invullen:
   DB-gegevens, `GITHUB_TOKEN`, `TEACHER_GITHUB_USERNAME`, `APP_SHARED_PASSWORD`.
4. Eerste docent (optioneel): `php bin/hash-password.php` en de INSERT uit `schema.sql` gebruiken.
   Zonder docent kan ingelogd worden met het gedeelde wachtwoord (laat e-mail leeg).
5. Alleen nginx (zonder Apache)? Voeg toe aan de extra nginx-directives:
   `location /api/ { try_files $uri /api/index.php$is_args$args; }`

API (JSON): `GET /api/health`, `GET /api/auth/me`, `POST /api/auth/login`
(`{email?, password}`), `POST /api/auth/logout`. Niet-publieke routes vereisen een
sessie en, bij POST/PUT/DELETE, de header `X-CSRF-Token`. Microsoft SSO:
`AuthService::handleMicrosoftCallback()` is een placeholder (501).

## Token instellen

1. Maak een fine-grained personal access token aan met alleen leesrechten op de
   teamrepo's (publieke repo's werken ook zonder token, maar dan zijn
   studenten met 0 commits niet zichtbaar).
2. Open het dashboard → **Token** → plak het token en eventueel je eigen
   GitHub-gebruikersnaam (die wordt uit de lijst gefilterd).
3. Het token wordt alleen in `localStorage` van jouw browser bewaard.

## Caching

- **Laag 1:** de ruwe teamdata wordt per repo in `localStorage` bewaard en
  gebruikt zolang die jonger is dan de TTL (keuzelijst in de toolbar,
  standaard 10 min, `0` = altijd live). Studentnamen en samengevoegde accounts
  worden altijd opnieuw toegepast, dus wijzigingen zijn direct zichtbaar.
- **Laag 2:** verlopen of geforceerde loads sturen `If-None-Match` mee. Een
  `304 Not Modified` telt niet mee voor de GitHub rate limit.
- **Data verversen** forceert een controle bij GitHub voor alle teams; het
  verversicoon op een teamkaart doet dat voor één team. **Cache legen** wist
  alles. Bij het wissen van het token wordt de cache ook geleegd.
- Bij een vol opslagquotum worden automatisch de oudste cache-entries opgeruimd.

## Deploy

Elke push naar `main` deployt via GitHub Actions naar GitHub Pages
(`.github/workflows/deploy.yml`). De workflow kopieert de frontend uit `public/`
(zonder `api/`) naar `_site/`.
