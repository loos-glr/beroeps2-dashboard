# BEROEPS2 · GitHub Flow Dashboard

Formatief dashboard voor het BEROEPS2-traject (Grafisch Lyceum Rotterdam). Het
dashboard leest publieke GitHub-activiteit (commits, pull requests, issues) van
de geconfigureerde teamrepo's en toont per student een status.

De frontend is een **Vue 3-app (Composition API)** zonder buildstap: native ES-modules, de Vue
*runtime*-build en [htm](https://github.com/developit/htm) voor JSX-achtige templates. Alle data komt
uit de PHP/MariaDB-API; in de browser staat alleen een voorkeur (laatst gekozen klas, "alleen aandacht")
en optioneel een persoonlijk GitHub-fallbacktoken. Er staan geen studenten, repo's of tokens in de code.

## Structuur

```
public/           Document root (Plesk: httpdocs/public)
  index.html      Alleen <head> + #app, met meta-CSP (geen inline script/style)
  css/ assets/    Stijlen en SVG-iconen
  js/             Vue-frontend (zie hieronder)
  api/index.php   Centraal JSON API-entrypoint (+ .htaccess rewrite)
src/              PHP 8.3 classes (namespace App\): Config, Database, Auth, Http, Controllers, Services
sql/schema.sql    MariaDB-installatiescript (volledige eindstand)
sql/migration_step5.sql  Upgrade van een bestaande database naar Stap 5 (idempotent)
bin/ dev/         CLI-hulpscript (wachtwoordhash) en router voor `php -S`
.env.example      Configuratiesjabloon (kopieer naar .env)
```

## Frontend (`public/js/`)

| Pad | Verantwoordelijkheid |
| --- | --- |
| `main.js` | `createApp(App).mount('#app')` |
| `lib/vue.js` | Enige importpunt voor Vue en `html` (htm gebonden aan `h`) |
| `vendor/` | Vue-runtime en htm, lokaal en vastgepind (zie `vendor/README.md`) |
| `api.js` | API-client: cookies, `X-CSRF-Token`, optioneel `X-GitHub-Token`, centrale 401 |
| `store/` | `session` (login), `contexts` (schooljaar/vak/klas), `dashboard` (teams, KPI's), `ui` (toasts, modal) |
| `util/` | Datums, statusmapping, veilige GitHub-links, localStorage, download |
| `components/` | `App`, `LoginView`, `ContextBar`, `DashboardView`, `TeamCard`, `StudentRow`, `StudentDetail`, modals, `manage/*`, `ClassBoardView` + `board/*` (digibord) |
| `store/board.js` | Digibord: voorkeuren, streefdoelen, `teamStats()`, klassommen en de auto-refresh-hartslag |

Conventies (voor wie React kent):

- Elk component is `{ props, emits, setup() { return () => html\`…\` } }`; state zit in `ref`/`computed`/`reactive`.
- `v-if` → `${cond ? html\`…\` : null}`, `v-for` → `${list.map(x => html\`<${C} key=${x.id} />\`)}`,
  `v-model` → `value=${v.value} onInput=${e => v.value = e.target.value}`, events als `onClick=${fn}`.
- State is een module-singleton (`reactive()`) met exporteerde acties; componenten muteren alleen via die acties.
- **Nooit** `innerHTML`/`v-html` of inline `style="…"`: de CSP (`script-src 'self'`, geen `unsafe-eval`) staat dat niet toe
  en CI controleert het. Dynamische breedtes lopen via `style=${{ width }}` (CSSOM).
- Externe links gaan via `ExtLink` (alleen `https://github.com/`).

## Digibord / klas-modus

De knop **Digibord-modus** (topbar; URL-hash `#digibord`) toont een projecteerbare klasweergave: klasdoelen
(commits, PR's, afgeronde issues) en grote teamtegels met voortgang en de laatste commit. Terug via
*Docentweergave*, `Esc` of de terugknop van de browser; *Volledig scherm* gebruikt de Fullscreen API.

- **Privacy:** in deze modus worden wachtrij, statusbadges, notities, logboeken, detail- en beheermodals niet gerenderd, en
  `openModal()` doet niets. Studentweergave: *Alleen teams* of *Teams + leden* (voornamen, alleen een groene ring voor actieve leden).
- **Streefdoelen** staan per klas en periode in `localStorage` (`glr_b2_board_goals`); standaard is `aantal teams × factor`.
- **Auto-verversen** (Uit / 3 / 5 min, standaard 3): een hartslag van 30 s ververst teams die ouder zijn dan het interval via
  `POST /teams/{id}/refresh?force=1&collaborators=0`. Collaborators worden dan alleen opnieuw opgehaald als ze nog nooit of langer dan
  24 uur geleden zijn gesynct. In een verborgen tabblad of onder 250 GraphQL-punten wordt niet ververst.

## Lokaal draaien (Docker Compose)

De primaire lokale omgeving bootst Plesk na: PHP 8.3 + Apache 2.4 (met `.htaccess`), MariaDB 10.11 en phpMyAdmin.

```bash
cp .env.example .env   # optioneel; zonder .env gelden de defaults uit docker-compose.yml
docker compose up -d --build
```

| Service | URL / poort | Opmerking |
| --- | --- | --- |
| Dashboard + API | http://localhost:8080 (`/api/health`) | `./` is gemount, wijzigingen zijn direct live |
| phpMyAdmin | http://localhost:8081 | automatisch ingelogd met de app-gebruiker |
| MariaDB | `localhost:3307` | root-wachtwoord `root_secret`; data in volume `db_data` |

De vendor-bestanden (`public/js/vendor/`) staan in git; er is geen installatiestap. Controle:
`docker compose exec -T app php bin/vendor.php --verify`.

Poort bezet? Zet `APP_PORT` / `PMA_PORT` in `.env` of de shell.
`sql/schema.sql` wordt bij de eerste start automatisch geladen. Opnieuw beginnen: `docker compose down -v`.
Bestaand volume bijwerken: `docker compose exec -T db mariadb -uroot -proot_secret glr_beroeps2 < sql/migration_step5.sql`.
Standaard inlogwachtwoord: `glr-docent-2026` (overschrijf met `APP_SHARED_PASSWORD`).
Tests in de container: `docker compose exec -T app php tests/merge_test.php` en `... tests/import_test.php`.

### Optioneel: zonder Docker

Lichtgewicht fallback met de PHP built-in server (vereist zelf een MariaDB en een ingevulde `.env`):

```bash
php -S localhost:8000 -t public dev/router.php
# dashboard: http://localhost:8000  ·  API: http://localhost:8000/api/health
```

## Backend & Plesk-installatie

1. Domein op **PHP 8.3** zetten; document root → `httpdocs/public`, repo in `httpdocs`.
2. MariaDB-database + gebruiker aanmaken en `sql/schema.sql` importeren (phpMyAdmin). Bestaande installatie? Importeer `sql/migration_step5.sql`.
3. `.env.example` kopiëren naar `.env` (buiten de document root) en invullen:
   DB-gegevens, `GITHUB_TOKEN`, `TEACHER_GITHUB_USERNAME`, `APP_SHARED_PASSWORD`.
4. Eerste docent (optioneel): `php bin/hash-password.php` en de INSERT uit `schema.sql` gebruiken.
   Zonder docent kan ingelogd worden met het gedeelde wachtwoord (laat e-mail leeg).
5. Vendor-bestanden (`public/js/vendor/`: Vue en htm) staan in git en komen mee met de deploy.
   - *Plesk → Git*: optioneel bij **Additional deployment actions**: `/opt/plesk/php/8.3/bin/php bin/vendor.php --verify`
     (laat de deploy zichtbaar falen als iets ontbreekt of afwijkt).
   - *Upload via File Manager/FTP*: kopieer `public/` inclusief `public/js/vendor/` en `bin/`.
   - Ontbreken ze toch: Plesk SSH-terminal, `cd httpdocs && /opt/plesk/php/8.3/bin/php bin/vendor.php --install`.
6. Alleen nginx (zonder Apache)? Voeg toe aan de extra nginx-directives:
   `location /api/ { try_files $uri /api/index.php$is_args$args; }`

API (JSON). Niet-publieke routes vereisen een sessie en, bij POST/PATCH/PUT/DELETE, de
header `X-CSRF-Token`. Microsoft SSO: `AuthService::handleMicrosoftCallback()` is een placeholder (501).

| Route | Doel |
| --- | --- |
| `GET /health`, `GET /auth/me`, `POST /auth/login` (`{email?, password}`), `POST /auth/logout` | Status en sessie |
| `GET /contexts`, `POST /contexts`, `PATCH /contexts/{id}` | Klassen (schooljaar + vak + klas), drempel, cache-TTL en `sprintStartDate` |
| `POST /contexts/{id}/import-json?dryRun=0\|1` | POC-export (`teams` + `aliases`, v1 of v2) idempotent importeren; `dryRun=1` rolt terug |
| `GET /contexts/{id}/dashboard?force=0\|1&period=all\|sprint\|7days\|today&sync=0\|1` | Alle teams, studenten en KPI's van een klas. Standaard `sync=0`: alleen uit de database (geen GitHub-calls); elk team heeft `needsSync`, `coaching` en per lid `coaching`. `force=1` synct synchroon |
| `POST /teams`, `PATCH /teams/{id}`, `DELETE /teams/{id}`, `POST /teams/{id}/refresh?period=&force=0\|1` | Teams en verwachte leden |
| `GET /students?q=`, `POST /students/identity`, `DELETE /students/{id}` | Studentnamen en gekoppelde GitHub-accounts (`handles` = volledige set) |
| `GET\|POST /contexts/{id}/coaching-logs`, `PATCH\|DELETE /coaching-logs/{id}` | Lesronde-logboek: `teamId?`, `studentId?` of `githubIdentifier`+`fullName` (maakt/koppelt student), `noteText?`, `followUpDate?`, `resolveDue?`; antwoorden bevatten `summaries` (`visitedToday`, `openFollowUps`, `dueFollowUps`) |
| `GET /github/rate-limit`, `GET /github/collaborator-repos?contextId=` | GitHub-status en repo-ontdekking |

GitHub-token: `GITHUB_TOKEN` uit `.env`; is die leeg dan wordt de request-header `X-GitHub-Token`
gebruikt. De GraphQL-sync **vereist een token**; zonder token tonen teams "GraphQL vereist een GitHub-token".

Tests: `php tests/merge_test.php` (accounts, periode-filter, samenvoegen, statusregels),
`php tests/import_test.php` (parsen van het JSON-importbestand) en `php tests/sync_test.php`
(GraphQL-parsing incl. lege repository, periodegrenzen in Europe/Amsterdam) hebben geen DB nodig.
`php tests/coaching_log_test.php` rekent `visitedToday`/`dueFollowUps` puur door en draait daarnaast tegen een echte
MariaDB, maar alleen als `DB_NAME` op `_test` eindigt (de tabellen worden gewist en uit `sql/schema.sql` opnieuw aangemaakt).
Lokaal: `CREATE DATABASE glr_beroeps2_test` + `GRANT` via de root-user van de db-container, daarna
`DB_HOST=127.0.0.1 DB_PORT=3307 DB_NAME=glr_beroeps2_test DB_USER=glr_user DB_PASS=glr_secret php tests/coaching_log_test.php`.
CI start hiervoor een MariaDB-service.

## Token instellen

Voorkeur: `GITHUB_TOKEN` in `.env` (fine-grained PAT met alleen leesrechten op de teamrepo's).
Heeft de server geen eigen token, dan kan een docent via **Token** in het dashboard een persoonlijk
fallback-token instellen; dat blijft in `localStorage` van die browser en gaat als `X-GitHub-Token`
naar de eigen server. Publieke repo's werken ook anoniem, maar dan ontbreken studenten met 0 commits.

## Synchronisatie en periode-filter

Er zijn geen webhooks of cronjobs: de sync gebeurt tijdens een dashboard-request, per team zodra de
cache-TTL (`academic_contexts.cache_ttl_minutes`) is verlopen.

- **Eén GraphQL-call per team** (`GitHubGraphQLService`, `POST https://api.github.com/graphql`, meestal 1 punt):
  `pushedAt`, aantal branches, de nieuwste commits op de default branch, de laatste 50 PR's en 50 issues.
- **Incrementeel:** commits worden opgehaald vanaf de nieuwste opgeslagen commit min 30 dagen (zodat commits van
  langlopende featurebranches niet worden gemist); PR's en issues zijn gesorteerd op `UPDATED_AT`. Alles wordt met
  `INSERT … ON DUPLICATE KEY UPDATE` opgeslagen in `repo_commits`, `repo_pull_requests` en `repo_issues`.
- **Collaborators** worden hooguit 1× per 24 uur (of bij `force=1`) opgehaald en staan in `repo_collaborators`.
  Heeft het token daar geen rechten voor, dan toont het team een melding en werkt de rest gewoon.
- **Periode** (`period=all|sprint|7days|today`) wordt volledig in SQL berekend; wisselen kost dus geen GitHub-calls.
  "Vandaag" en "Sprint" gebruiken de dagwisseling van Europe/Amsterdam. Commits, PR's en aangemaakte issues volgen het
  filter; assigned issues (open/closed) en de **status** (groen/oranje/rood) baseren zich altijd op alle activiteit.
- **Achtergrond-sync:** het dashboard laadt altijd direct uit MariaDB. Teams met `needsSync` (nooit gesynct of ouder
  dan de cache-TTL) worden daarna door de frontend één voor één ververst (`POST /teams/{id}/refresh?force=0`); de
  toolbar toont "Achtergrond-sync: team 2 van 6". Van klas wisselen breekt de queue af. **Ververs alles** forceert alle
  teams van de klas op dezelfde manier, het verversicoon op een teamkaart doet dat voor één team.
- De toolbar toont de GraphQL-limiet en hoeveel punten de syncs kostten.
- Studentnamen en koppelingen worden bij elke dashboard-request live over de data gelegd, dus
  wijzigingen kosten geen GitHub-calls.
- `github_http_cache` (ETag) wordt nog gebruikt voor de repo-ontdekking (`/user/repos`).

## Lesronde en logboek

**Lesronde / Wachtrij (X)** in de toolbar opent een geprioriteerde lijst: (1) verlopen of vandaag op te volgen
afspraken, (2) rode studenten, (3) oranje studenten, (4) teams die vandaag nog niet zijn bezocht. *Vandaag besproken ✓*
maakt met één klik een logregel; bij een verlopen afspraak rondt *Afspraak afgerond ✓* de oude afspraak af, zodat die
morgen niet terugkomt. In de studentdetails staat het chronologische *Formatief Logboek & Lesafspraken* (los van de
vaste achtergrondnotitie). "Vandaag" volgt de dagwisseling van Europe/Amsterdam; een logregel zonder opvolgdatum telt
niet als openstaande afspraak. Een lid zonder studentrecord krijgt bij de eerste logregel automatisch een basisrecord.

## Migratie vanuit het oude dashboard

Bevat de browser nog POC-gegevens (`glr_beroeps2_teams_v1` / `glr_beroeps2_student_aliases_v1`), dan biedt
het dashboard aan die in de gekozen klas te importeren (eerst een preview met `dryRun=1`). Een `.json`-export
van het oude dashboard kan via **Beheer → Import & Export**. Daar staat ook **Exporteer huidige klas**
(zelfde v2-formaat, dus weer importeerbaar).

## Deploy en CI

Deploy gaat via Plesk (zie *Backend & Plesk-installatie*); de frontend heeft geen buildstap, dus
het kopiëren van `public/` volstaat. GitHub Actions (`.github/workflows/ci.yml`) draait op elke push/PR:
`php -l`, de PHP-tests, `node --check`, `bin/vendor.php --verify` (sha256 van de vendor-bestanden) en een guard tegen `innerHTML`, `eval` en inline styles.
GitHub Pages wordt niet meer gebruikt: de frontend werkt niet zonder de PHP-API.
