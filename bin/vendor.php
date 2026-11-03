<?php

declare(strict_types=1);

// Gebruik: php bin/vendor.php            (= --verify: controleer aanwezigheid, sha256 en CSP-eis)
//          php bin/vendor.php --install  (download ontbrekende of afwijkende bestanden, controleer hash vóór opslaan)
// Bijwerken: pas versie, URL en sha256 hieronder aan, draai --install en commit de bestanden.

if (PHP_SAPI !== 'cli') {
    exit(1);
}

const VENDOR_DIR = __DIR__ . '/../public/js/vendor';

const MANIFEST = [
    'vue.runtime.esm-browser.prod.js' => [
        'version' => 'Vue 3.5.13',
        'url' => 'https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.runtime.esm-browser.prod.js',
        'sha256' => 'beb6a8f2953386b171fb20e5c719e96082f3b0cf29a88d24158f61b824e3c1d4',
    ],
    'htm.module.js' => [
        'version' => 'htm 3.1.1',
        'url' => 'https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.module.js',
        'sha256' => 'ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4',
    ],
];

function fileOk(string $path, string $sha256): bool
{
    return is_file($path) && hash_file('sha256', $path) === $sha256;
}

function download(string $url): ?string
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

    return is_string($body) && $code === 200 ? $body : null;
}

$install = in_array('--install', $argv, true);
$failed = false;

if (!is_dir(VENDOR_DIR) && !mkdir(VENDOR_DIR, 0775, true)) {
    fwrite(STDERR, "Kan map niet aanmaken: " . VENDOR_DIR . PHP_EOL);
    exit(1);
}

foreach (MANIFEST as $name => $entry) {
    $path = VENDOR_DIR . '/' . $name;

    if (fileOk($path, $entry['sha256'])) {
        echo "OK       $name ({$entry['version']})", PHP_EOL;
        continue;
    }

    if (!$install) {
        $reason = is_file($path) ? 'sha256 wijkt af' : 'ontbreekt';
        fwrite(STDERR, "FOUT     $name $reason (herstel met: php bin/vendor.php --install)" . PHP_EOL);
        $failed = true;
        continue;
    }

    $body = download($entry['url']);
    if ($body === null || hash('sha256', $body) !== $entry['sha256']) {
        fwrite(STDERR, "FOUT     $name: download mislukt of hash klopt niet ({$entry['url']})" . PHP_EOL);
        $failed = true;
        continue;
    }

    $tmp = $path . '.tmp';
    if (file_put_contents($tmp, $body) === false || !rename($tmp, $path)) {
        fwrite(STDERR, "FOUT     $name: schrijven mislukt" . PHP_EOL);
        $failed = true;
        continue;
    }
    echo "GEÏNSTALLEERD $name ({$entry['version']})", PHP_EOL;
}

// De CSP staat geen unsafe-eval toe: de Vue-runtime mag geen `new Function` bevatten.
$vue = VENDOR_DIR . '/vue.runtime.esm-browser.prod.js';
if (is_file($vue) && str_contains((string) file_get_contents($vue), 'new Function')) {
    fwrite(STDERR, "FOUT     vue.runtime.esm-browser.prod.js bevat 'new Function' (CSP vereist dan unsafe-eval)" . PHP_EOL);
    $failed = true;
}

exit($failed ? 1 : 0);
