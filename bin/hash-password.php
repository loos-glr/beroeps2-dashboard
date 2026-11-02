<?php

declare(strict_types=1);

// Gebruik: php bin/hash-password.php  (wachtwoord wordt verborgen gevraagd)
// Of:      php bin/hash-password.php 'wachtwoord'
require dirname(__DIR__) . '/src/Auth/AuthService.php';

if (PHP_SAPI !== 'cli') {
    exit(1);
}

$password = $argv[1] ?? null;
if ($password === null) {
    fwrite(STDERR, 'Wachtwoord: ');
    if (PHP_OS_FAMILY !== 'Windows') {
        shell_exec('stty -echo');
    }
    $password = trim((string) fgets(STDIN));
    if (PHP_OS_FAMILY !== 'Windows') {
        shell_exec('stty echo');
    }
    fwrite(STDERR, PHP_EOL);
}

echo App\Auth\AuthService::hashPassword($password), PHP_EOL;
