<?php

declare(strict_types=1);

namespace App\Services;

use DateTimeImmutable;
use DateTimeZone;

/** UTC-datumhulpjes; alle DATETIMEs in de database zijn UTC. */
final class Dates
{
    public static function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }

    /** 'Y-m-d H:i:s' (UTC, uit MariaDB) → '2026-11-02T21:10:00Z' */
    public static function fromDb(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z');
    }
}
