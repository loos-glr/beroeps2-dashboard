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
sql/schema.sql    MariaDB-installatiescript
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
| `components/` | `App`, `LoginView`, `ContextBar`, `DashboardView`, `TeamCard`, `StudentRow`, `StudentDetail`, modals, `manage/*` |

Conventies (voor wie React kent):

- Elk component is `{ props, emits, setup() { return () => html\`…\` } }`; state zit in `ref`/`computed`/`reactive`.
- `v-if` → `${cond ? html\`…\` : null}`, `v-for` → `${list.map(x => html\`<${C} key=${x.id} />\`)}`,
  `v-model` → `value=${v.value} onInput=${e => v.value = e.target.value}`, events als `onClick=${fn}`.
- State is een module-singleton (`reactive()`) met exporteerde acties; componenten muteren alleen via die acties.
- **Nooit** `innerHTML`/`v-html` of inline `style="…"`: de CSP (`script-src 'self'`, geen `unsafe-eval`) staat dat niet toe
  en CI controleert het. Dynamische breedtes lopen via `style=${{ width }}` (CSSOM).
- Externe links gaan via `ExtLink` (alleen `https://github.com/`).

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

Poort bezet? Zet `APP_PORT` / `PMA_PORT` in `.env` of de shell.
`sql/schema.sql` wordt bij de eerste start automatisch geladen. Opnieuw beginnen: `docker compose down -v`.
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
2. MariaDB-database + gebruiker aanmaken en `sql/schema.sql` importeren (phpMyAdmin).
3. `.env.example` kopiëren naar `.env` (buiten de document root) en invullen:
   DB-gegevens, `GITHUB_TOKEN`, `TEACHER_GITHUB_USERNAME`, `APP_SHARED_PASSWORD`.
4. Eerste docent (optioneel): `php bin/hash-password.php` en de INSERT uit `schema.sql` gebruiken.
   Zonder docent kan ingelogd worden met het gedeelde wachtwoord (laat e-mail leeg).
5. Alleen nginx (zonder Apache)? Voeg toe aan de extra nginx-directives:
   `location /api/ { try_files $uri /api/index.php$is_args$args; }`

API (JSON). Niet-publieke routes vereisen een sessie en, bij POST/PATCH/PUT/DELETE, de
header `X-CSRF-Token`. Microsoft SSO: `AuthService::handleMicrosoftCallback()` is een placeholder (501).

| Route | Doel |
| --- | --- |
| `GET /health`, `GET /auth/me`, `POST /auth/login` (`{email?, password}`), `POST /auth/logout` | Status en sessie |
| `GET /contexts`, `POST /contexts`, `PATCH /contexts/{id}` | Klassen (schooljaar + vak + klas), drempel en cache-TTL |
| `POST /contexts/{id}/import-json?dryRun=0\|1` | POC-export (`teams` + `aliases`, v1 of v2) idempotent importeren; `dryRun=1` rolt terug |
| `GET /contexts/{id}/dashboard?force=0\|1` | Alle teams, studenten en KPI's van een klas |
| `POST /teams`, `PATCH /teams/{id}`, `DELETE /teams/{id}`, `POST /teams/{id}/refresh` | Teams en verwachte leden |
| `GET /students?q=`, `POST /students/identity`, `DELETE /students/{id}` | Studentnamen en gekoppelde GitHub-accounts (`handles` = volledige set) |
| `GET /github/rate-limit`, `GET /github/collaborator-repos?contextId=` | GitHub-status en repo-ontdekking |

GitHub-token: `GITHUB_TOKEN` uit `.env`; is die leeg dan wordt de request-header `X-GitHub-Token`
gebruikt, anders werkt de API anoniem (60 requests/uur, geen collaborators).

Tests (geen DB nodig): `php tests/merge_test.php` (samenvoegen, statusregels, snapshot-filters) en
`php tests/import_test.php` (parsen van het JSON-importbestand).

## Token instellen

Voorkeur: `GITHUB_TOKEN` in `.env` (fine-grained PAT met alleen leesrechten op de teamrepo's).
Heeft de server geen eigen token, dan kan een docent via **Token** in het dashboard een persoonlijk
fallback-token instellen; dat blijft in `localStorage` van die browser en gaat als `X-GitHub-Token`
naar de eigen server. Publieke repo's werken ook anoniem, maar dan ontbreken studenten met 0 commits.

## Caching

- **Laag 1:** `team_snapshots` met TTL = `academic_contexts.cache_ttl_minutes` (instelbaar per klas).
- **Laag 2:** `github_http_cache` (ETag/`304 Not Modified`, telt niet mee voor de GitHub rate limit).
- Studentnamen en koppelingen worden bij elke dashboard-request live over de snapshot gelegd, dus
  wijzigingen kosten geen GitHub-calls. **Data verversen** (`force=1`) revalideert alle teams,
  het verversicoon op een teamkaart doet dat voor één team.
- De oude browser-cache (`glr_beroeps2_etag_v1:*`, `glr_beroeps2_team_cache_v1`) wordt bij het opstarten opgeruimd.

## Migratie vanuit het oude dashboard

Bevat de browser nog POC-gegevens (`glr_beroeps2_teams_v1` / `glr_beroeps2_student_aliases_v1`), dan biedt
het dashboard aan die in de gekozen klas te importeren (eerst een preview met `dryRun=1`). Een `.json`-export
van het oude dashboard kan via **Beheer → Import & Export**. Daar staat ook **Exporteer huidige klas**
(zelfde v2-formaat, dus weer importeerbaar).

## Deploy en CI

Deploy gaat via Plesk (zie *Backend & Plesk-installatie*); de frontend heeft geen buildstap, dus
het kopiëren van `public/` volstaat. GitHub Actions (`.github/workflows/ci.yml`) draait op elke push/PR:
`php -l`, de PHP-tests, `node --check` en een guard tegen `innerHTML`, `eval` en inline styles.
GitHub Pages wordt niet meer gebruikt: de frontend werkt niet zonder de PHP-API.
