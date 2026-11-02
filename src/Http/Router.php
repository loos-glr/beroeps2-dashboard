<?php

declare(strict_types=1);

namespace App\Http;

use App\Auth\AuthService;

/**
 * Eenvoudige router met route-parameters ('/teams/{id}'). Niet-publieke routes lopen via
 * AuthService::requireAuth() (+ CSRF bij muterende methodes).
 */
final class Router
{
    /** @var list<array{method: string, regex: string, handler: callable, public: bool}> */
    private array $routes = [];

    public function __construct(private readonly AuthService $auth)
    {
    }

    /** @param callable(Request): mixed $handler */
    public function add(string $method, string $path, callable $handler, bool $public = false): void
    {
        $regex = preg_replace('/\\\\\{([a-z][a-z0-9_]*)\\\\\}/i', '(?P<$1>[^/]+)', preg_quote($path, '#'));
        $this->routes[] = [
            'method' => strtoupper($method),
            'regex' => '#^' . $regex . '$#',
            'handler' => $handler,
            'public' => $public,
        ];
    }

    public function dispatch(Request $request): never
    {
        $allowed = [];
        $route = null;
        $params = [];

        foreach ($this->routes as $candidate) {
            if (preg_match($candidate['regex'], $request->path, $m) !== 1) {
                continue;
            }
            $allowed[] = $candidate['method'];
            if ($candidate['method'] === $request->method && $route === null) {
                $route = $candidate;
                $params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
            }
        }

        if ($allowed === []) {
            throw new HttpException(404, 'Route niet gevonden');
        }
        if ($route === null) {
            header('Allow: ' . implode(', ', array_unique($allowed)));
            throw new HttpException(405, 'Methode niet toegestaan');
        }

        if (!$route['public']) {
            $this->auth->requireAuth();
            if (!in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
                $this->auth->verifyCsrf($request);
            }
        }

        JsonResponse::send(($route['handler'])($request->withParams($params)) ?? ['ok' => true]);
    }
}
