<?php

declare(strict_types=1);

use App\Auth\AuthService;
use App\Auth\SessionManager;
use App\Controllers\AuthController;
use App\Controllers\HealthController;
use App\Database\Database;
use App\Http\Request;
use App\Http\Router;

$config = require dirname(__DIR__, 2) . '/src/bootstrap.php';

$session = new SessionManager($config);

// Lazy: de DB-verbinding wordt pas opgebouwd als een login die nodig heeft
$auth = new AuthService(static fn () => Database::getConnection(), $config, $session);
$authController = new AuthController($auth);
$health = new HealthController();

$router = new Router($auth);
$router->add('GET', '/health', fn () => $health->show(), public: true);
$router->add('POST', '/auth/login', fn (Request $r) => $authController->login($r), public: true);
$router->add('GET', '/auth/me', fn () => $authController->me(), public: true);
$router->add('POST', '/auth/logout', fn () => $authController->logout());
$router->add('GET', '/auth/microsoft/login', fn (Request $r) => $authController->microsoft($r), public: true);
$router->add('GET', '/auth/microsoft/callback', fn (Request $r) => $authController->microsoft($r), public: true);

$router->dispatch(Request::fromGlobals());
