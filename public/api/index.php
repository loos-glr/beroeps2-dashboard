<?php

declare(strict_types=1);

use App\Auth\AuthService;
use App\Auth\SessionManager;
use App\Controllers\AuthController;
use App\Controllers\ContextController;
use App\Controllers\GitHubController;
use App\Controllers\HealthController;
use App\Controllers\StudentController;
use App\Controllers\TeamController;
use App\Database\Database;
use App\Http\Request;
use App\Http\Router;
use App\Services\ContextService;
use App\Services\GitHubClientService;
use App\Services\GitHubGraphQLService;
use App\Services\MigrationService;
use App\Services\StudentIdentityService;
use App\Services\TeamAnalyticsService;
use App\Services\TeamService;

$config = require dirname(__DIR__, 2) . '/src/bootstrap.php';

$request = Request::fromGlobals();
$session = new SessionManager($config);

// Lazy: de DB-verbinding wordt pas opgebouwd als een request die nodig heeft
$db = static fn () => Database::getConnection();
$auth = new AuthService($db, $config, $session);
$authController = new AuthController($auth);
$health = new HealthController();

$github = new GitHubClientService($db, $config, $request->header('X-GitHub-Token'));
$contexts = new ContextService($db);
$graphql = new GitHubGraphQLService($db, $github, $config);
$analytics = new TeamAnalyticsService($db, $github, $graphql, $config);
$contextController = new ContextController($contexts, $analytics, new MigrationService($db));
$teamController = new TeamController(new TeamService($db, $github), $analytics);
$studentController = new StudentController(new StudentIdentityService($db));
$githubController = new GitHubController($github, $db);

$router = new Router($auth);
$router->add('GET', '/health', fn () => $health->show(), public: true);
$router->add('POST', '/auth/login', fn (Request $r) => $authController->login($r), public: true);
$router->add('GET', '/auth/me', fn () => $authController->me(), public: true);
$router->add('POST', '/auth/logout', fn () => $authController->logout());
$router->add('GET', '/auth/microsoft/login', fn (Request $r) => $authController->microsoft($r), public: true);
$router->add('GET', '/auth/microsoft/callback', fn (Request $r) => $authController->microsoft($r), public: true);

$router->add('GET', '/contexts', fn () => $contextController->index());
$router->add('POST', '/contexts', fn (Request $r) => $contextController->store($r));
$router->add('PATCH', '/contexts/{id}', fn (Request $r) => $contextController->update($r));
$router->add('POST', '/contexts/{id}/import-json', fn (Request $r) => $contextController->importJson($r));
$router->add('GET', '/contexts/{id}/dashboard', fn (Request $r) => $contextController->dashboard($r));

$router->add('POST', '/teams', fn (Request $r) => $teamController->store($r));
$router->add('PATCH', '/teams/{id}', fn (Request $r) => $teamController->update($r));
$router->add('DELETE', '/teams/{id}', fn (Request $r) => $teamController->destroy($r));
$router->add('POST', '/teams/{id}/refresh', fn (Request $r) => $teamController->refresh($r));

$router->add('GET', '/students', fn (Request $r) => $studentController->index($r));
$router->add('POST', '/students/identity', fn (Request $r) => $studentController->identity($r));
$router->add('DELETE', '/students/{id}', fn (Request $r) => $studentController->destroy($r));

$router->add('GET', '/github/rate-limit', fn () => $githubController->rateLimit());
$router->add('GET', '/github/collaborator-repos', fn (Request $r) => $githubController->collaboratorRepos($r));

$router->dispatch($request);
