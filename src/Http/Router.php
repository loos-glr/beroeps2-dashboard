<?php

declare(strict_types=1);

namespace App\Http;

use App\Auth\AuthService;

/** Eenvoudige router. Niet-publieke routes lopen via AuthService::requireAuth() (+ CSRF bij muterende methodes). */
final class Router
{
    /** @var array<string, array<string, array{handler: callable, public: bool}>> */
    private array $routes = [];

    public function __construct(private readonly AuthService $auth)
    {
    }

    /** @param callable(Request): mixed $handler */
    public function add(string $method, string $path, callable $handler, bool $public = false): void
    {
        $this->routes[$path][strtoupper($method)] = ['handler' => $handler, 'public' => $public];
    }

    public function dispatch(Request $request): never
    {
        $methods = $this->routes[$request->path] ?? null;
        if ($methods === null) {
            throw new HttpException(404, 'Route niet gevonden');
        }

        $route = $methods[$request->method] ?? null;
        if ($route === null) {
            header('Allow: ' . implode(', ', array_keys($methods)));
            throw new HttpException(405, 'Methode niet toegestaan');
        }

        if (!$route['public']) {
            $this->auth->requireAuth();
            if (!in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
                $this->auth->verifyCsrf($request);
            }
        }

        JsonResponse::send(($route['handler'])($request) ?? ['ok' => true]);
    }
}
