<?php

declare(strict_types=1);

// Router voor de PHP built-in server (leest geen .htaccess):
//   php -S localhost:8000 -t public dev/router.php
$path = (string) parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);

if (str_starts_with($path, '/api/') && !str_starts_with($path, '/api/index.php')) {
    $_SERVER['SCRIPT_NAME'] = '/api/index.php';
    require __DIR__ . '/../public/api/index.php';
    return true;
}

return false;
