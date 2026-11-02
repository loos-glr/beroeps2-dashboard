<?php

declare(strict_types=1);

namespace App\Config;

use RuntimeException;

/**
 * Veilige .env-loader. Waarden blijven in een interne array (geen putenv/$_ENV),
 * zodat secrets niet via getenv() of phpinfo() zichtbaar worden.
 * Echte omgevingsvariabelen (bijv. uit Plesk) hebben voorrang op het bestand.
 */
final class Env
{
    /** @var array<string, string> */
    private static array $values = [];

    public static function load(string $path): void
    {
        if (!is_file($path) || !is_readable($path)) {
            return;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES);
        if ($lines === false) {
            return;
        }

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            if (str_starts_with($line, 'export ')) {
                $line = ltrim(substr($line, 7));
            }

            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }

            $key = trim(substr($line, 0, $pos));
            if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $key)) {
                continue;
            }

            self::$values[$key] = self::parseValue(trim(substr($line, $pos + 1)));
        }
    }

    private static function parseValue(string $raw): string
    {
        if ($raw === '') {
            return '';
        }

        $quote = $raw[0];
        if ($quote === '"' || $quote === "'") {
            $end = strrpos($raw, $quote);
            if ($end !== false && $end > 0) {
                $inner = substr($raw, 1, $end - 1);
                return $quote === '"'
                    ? strtr($inner, ['\\n' => "\n", '\\"' => '"', '\\\\' => '\\'])
                    : $inner;
            }
        }

        // Onbehandelde waarde: eindcommentaar (" #...") verwijderen
        $hash = strpos($raw, ' #');
        return rtrim($hash === false ? $raw : substr($raw, 0, $hash));
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $real = $_SERVER[$key] ?? getenv($key);
        if (is_string($real) && $real !== '') {
            return $real;
        }
        return self::$values[$key] ?? $default;
    }

    public static function string(string $key, string $default = ''): string
    {
        return self::get($key, $default) ?? $default;
    }

    public static function int(string $key, int $default = 0): int
    {
        $value = self::get($key);
        return $value !== null && is_numeric($value) ? (int) $value : $default;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);
        if ($value === null || $value === '') {
            return $default;
        }
        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }

    public static function require(string $key): string
    {
        $value = self::get($key);
        if ($value === null || $value === '') {
            throw new RuntimeException("Verplichte configuratie ontbreekt: {$key}");
        }
        return $value;
    }
}
