<?php

declare(strict_types=1);

namespace App\Services;

use App\Http\HttpException;
use RuntimeException;

/** Fout van of richting de GitHub API. Status 0 = netwerkfout. */
final class GitHubApiException extends RuntimeException
{
    /** @param array<string, mixed>|null $rateLimit */
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly ?array $rateLimit = null,
        private readonly bool $rateLimited = false,
    ) {
        parent::__construct($message);
    }

    public function isRateLimited(): bool
    {
        return $this->rateLimited;
    }

    /** Een upstream-401 wordt bewust géén 401: de frontend leest dat als "niet ingelogd". */
    public function toHttpException(): HttpException
    {
        if ($this->rateLimited) {
            $reset = isset($this->rateLimit['resetAt']) ? gmdate('H:i', (int) strtotime((string) $this->rateLimit['resetAt'])) : null;
            return new HttpException(429, 'GitHub rate limit bereikt' . ($reset ? " (reset {$reset} UTC)" : ''));
        }
        return match (true) {
            $this->status === 401 => new HttpException(502, $this->getMessage() !== '' ? $this->getMessage() : 'GitHub-token ongeldig of verlopen'),
            $this->status === 403 => new HttpException(502, 'Geen toegang tot deze GitHub-resource'),
            $this->status === 404 => new HttpException(404, 'Repository niet gevonden of geen toegang'),
            $this->status === 0 => new HttpException(504, 'GitHub niet bereikbaar'),
            default => new HttpException(502, 'GitHub API-fout'),
        };
    }
}
