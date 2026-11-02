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

    /** Vandaag als 'Y-m-d' in Europe/Amsterdam (dagwisseling van de school, niet van UTC). */
    public static function localToday(DateTimeImmutable $now): string
    {
        return $now->setTimezone(new DateTimeZone(self::SCHOOL_TZ))->format('Y-m-d');
    }

    public const PERIODS = ['all', 'sprint', '7days', 'today'];
    private const SCHOOL_TZ = 'Europe/Amsterdam';

    /**
     * Begin van een periode in UTC (null = geen ondergrens). 'today' en 'sprint' rekenen met de
     * dagwisseling in Europe/Amsterdam, omdat alle DATETIMEs in UTC staan.
     *
     * @return array{from: ?DateTimeImmutable, fallback: bool}
     */
    public static function periodStart(string $period, ?string $sprintStart, DateTimeImmutable $now): array
    {
        $utc = new DateTimeZone('UTC');
        $local = new DateTimeZone(self::SCHOOL_TZ);
        switch ($period) {
            case 'today':
                return ['from' => $now->setTimezone($local)->setTime(0, 0)->setTimezone($utc), 'fallback' => false];
            case '7days':
                return ['from' => $now->modify('-7 days'), 'fallback' => false];
            case 'sprint':
                if ($sprintStart === null || $sprintStart === '') {
                    return ['from' => null, 'fallback' => true];
                }
                return ['from' => (new DateTimeImmutable($sprintStart . ' 00:00:00', $local))->setTimezone($utc), 'fallback' => false];
            default:
                return ['from' => null, 'fallback' => false];
        }
    }
}
