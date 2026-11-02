<?php

declare(strict_types=1);

namespace App\Http;

/** Stuurt JSON-responses met veilige standaard-headers. */
final class JsonResponse
{
    public static function send(mixed $data, int $status = 200): never
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
        }
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        exit;
    }

    public static function error(int $status, string $message): never
    {
        self::send(['error' => $message], $status);
    }
}
