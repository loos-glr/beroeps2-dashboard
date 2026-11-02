<?php

declare(strict_types=1);

use App\Config\Config;
use App\Config\Env;
use App\Database\Database;
use App\Http\HttpException;
use App\Http\JsonResponse;

/** PSR-4 autoloader (App\ → src/), zodat Composer op Plesk optioneel is. */
spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'App\\')) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

Env::load(dirname(__DIR__) . '/.env');
$config = Config::fromEnv();
Database::configure($config);

ini_set('display_errors', '0');
error_reporting(E_ALL);

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(static function (Throwable $e) use ($config): void {
    if ($e instanceof HttpException) {
        JsonResponse::error($e->status, $e->getMessage());
    }
    error_log((string) $e);
    JsonResponse::error(500, $config->debug ? $e->getMessage() : 'Interne serverfout');
});

return $config;
