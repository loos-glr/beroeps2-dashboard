<?php

declare(strict_types=1);

namespace App\Services;

/** Normaliseert GitHub-usernames en Git-auteurnamen naar de opslagvorm (lowercase, zonder @). */
final class GitHubIdentifier
{
    public static function normalize(string $value): string
    {
        $value = trim($value);
        if (str_starts_with($value, '@')) {
            $value = substr($value, 1);
        }
        return mb_strtolower(trim($value));
    }

    /**
     * @param array<mixed> $values
     * @return list<string> genormaliseerd, zonder lege waarden en dubbelen
     */
    public static function normalizeList(array $values): array
    {
        $out = [];
        foreach ($values as $value) {
            if (!is_string($value)) {
                continue;
            }
            $id = self::normalize($value);
            if ($id !== '') {
                $out[$id] = true;
            }
        }
        return array_map('strval', array_keys($out));
    }

    public static function isBot(string $login, ?string $type = null): bool
    {
        return $type === 'Bot' || str_ends_with(mb_strtolower($login), '[bot]');
    }

    /** 'https://github.com/owner/repo.git' → 'owner/repo'; null als het geen geldige repo is. */
    public static function normalizeRepo(string $value): ?string
    {
        $value = trim($value);
        $value = preg_replace('#^https?://(www\.)?github\.com/#i', '', $value) ?? $value;
        $value = rtrim($value, '/');
        $value = preg_replace('/\.git$/i', '', $value) ?? $value;

        if (preg_match('#^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/([A-Za-z0-9._-]{1,100})$#', $value, $m) !== 1) {
            return null;
        }
        return in_array($m[1], ['.', '..'], true) ? null : $value;
    }
}
