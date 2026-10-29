# BEROEPS2 · GitHub Flow Dashboard

Formatief dashboard voor het BEROEPS2-traject (Grafisch Lyceum Rotterdam). Het
dashboard leest publieke GitHub-activiteit (commits, pull requests, issues) van
de geconfigureerde teamrepo's en toont per student een status.

Alle configuratie (teams, studentnamen, token) blijft **lokaal in de browser**
(localStorage). Er staan geen studenten, repo's of tokens in de code.

## Structuur

```
index.html        Markup en modals (geen inline CSS/JS)
css/styles.css    Volledige stylesheet (design tokens + componenten)
assets/icons.svg  SVG-sprite met alle iconen
js/               ES-modules, zie hieronder
```

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

De app gebruikt ES-modules; die werken niet via `file://`. Start daarom een
lokale server vanuit de projectmap:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Of met Node:

```bash
npx serve .
```

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
(`.github/workflows/deploy.yml`). De workflow kopieert `index.html`, `css/`,
`js/` en `assets/` naar `_site/`.
