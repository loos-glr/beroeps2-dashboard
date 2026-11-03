# Vendor-bestanden

Lokale kopieën, zodat er geen Node-build en geen CDN-runtime nodig is.

| Bestand | Versie | Bron | sha256 |
| --- | --- | --- | --- |
| `vue.runtime.esm-browser.prod.js` | Vue 3.5.13 (runtime, **zonder** template-compiler) | https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.runtime.esm-browser.prod.js | `beb6a8f2953386b171fb20e5c719e96082f3b0cf29a88d24158f61b824e3c1d4` |
| `htm.module.js` | htm 3.1.1 | https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.module.js | `ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4` |

## Bijwerken

De bestanden staan in git. `bin/vendor.php` bevat het manifest (versie, URL, sha256) en is de bron van waarheid.

```bash
php bin/vendor.php            # controleer aanwezigheid, sha256 en dat Vue geen `new Function` bevat (CI doet dit ook)
php bin/vendor.php --install  # download ontbrekende/afwijkende bestanden, hash wordt gecontroleerd vóór opslaan
```

Nieuwe versie: pas versie, URL en sha256 aan in `bin/vendor.php`, draai `--install`, werk de tabel hierboven bij en commit.
