<?php

declare(strict_types=1);

namespace App\Config;

use App\Services\GitHubIdentifier;

/** Getypeerde applicatieconfiguratie, samengesteld uit de omgeving (.env). */
final class Config
{
    public function __construct(
        public readonly string $env,
        public readonly bool $debug,
        public readonly string $dbHost,
        public readonly int $dbPort,
        public readonly string $dbName,
        public readonly string $dbUser,
        public readonly string $dbPass,
        public readonly string $githubToken,
        /** @var list<string> */
        public readonly array $excludedGithubAccounts,
        public readonly string $sharedPassword,
        public readonly string $sessionName,
        public readonly int $sessionLifetimeMinutes,
    ) {
    }

    public static function fromEnv(): self
    {
        return new self(
            env: Env::string('APP_ENV', 'production'),
            debug: Env::bool('APP_DEBUG', false),
            dbHost: Env::string('DB_HOST', 'localhost'),
            dbPort: Env::int('DB_PORT', 3306),
            dbName: Env::string('DB_NAME'),
            dbUser: Env::string('DB_USER'),
            dbPass: Env::string('DB_PASS'),
            githubToken: Env::string('GITHUB_TOKEN'),
            excludedGithubAccounts: GitHubIdentifier::normalizeList(explode(',', Env::string('TEACHER_GITHUB_USERNAME'))),
            sharedPassword: Env::string('APP_SHARED_PASSWORD'),
            sessionName: Env::string('SESSION_NAME', 'glr_dash'),
            sessionLifetimeMinutes: max(1, Env::int('SESSION_LIFETIME_MINUTES', 480)),
        );
    }
}
