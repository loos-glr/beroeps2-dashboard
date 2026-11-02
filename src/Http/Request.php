<?php

declare(strict_types=1);

namespace App\Http;

/** Minimale, onveranderlijke weergave van het binnenkomende HTTP-verzoek. */
final class Request
{
    /**
     * @param array<string, mixed> $query
     * @param array<string, string> $headers lowercase header-namen
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        private readonly string $rawBody,
        public readonly array $headers,
        /** @var array<string, string> route-parameters, bv. {id} */
        public readonly array $params = [],
    ) {
    }

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($value) && str_starts_with($key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE']) && is_string($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = $_SERVER['CONTENT_TYPE'];
        }

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            self::resolvePath(),
            $_GET,
            (string) file_get_contents('php://input'),
            $headers,
        );
    }

    /** Pad relatief aan /api; werkt met rewrite (/api/health) én zonder (/api/index.php/health). */
    private static function resolvePath(): string
    {
        $uri = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '');   // /api/index.php
        $base = str_replace('\\', '/', dirname($script));     // /api

        if ($script !== '' && str_starts_with($uri, $script)) {
            $uri = substr($uri, strlen($script));
        } elseif ($base !== '/' && $base !== '.' && str_starts_with($uri, $base)) {
            $uri = substr($uri, strlen($base));
        }

        return '/' . trim(rawurldecode($uri), '/');
    }

    /** @param array<string, string> $params */
    public function withParams(array $params): self
    {
        return new self($this->method, $this->path, $this->query, $this->rawBody, $this->headers, $params);
    }

    /** Positieve INT UNSIGNED uit het pad; anders 404 (zo matcht /teams/abc nooit). */
    public function intParam(string $name): int
    {
        $raw = $this->params[$name] ?? '';
        if (preg_match('/^[1-9]\d{0,9}$/', $raw) !== 1 || (int) $raw > 4294967295) {
            throw new HttpException(404, 'Route niet gevonden');
        }
        return (int) $raw;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    /** @return array<string, mixed> */
    public function json(): array
    {
        if (trim($this->rawBody) === '') {
            return [];
        }
        $data = json_decode($this->rawBody, true);
        if (!is_array($data)) {
            throw new HttpException(400, 'Ongeldige JSON in request body');
        }
        return $data;
    }
}
