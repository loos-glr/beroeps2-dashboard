<?php

declare(strict_types=1);

namespace App\Http;

/** Kleine validators voor request-bodies; falen met HTTP 422. */
final class Validate
{
    /** @param array<string, mixed> $body */
    public static function string(array $body, string $key, int $min, int $max, bool $required = true): ?string
    {
        if (!array_key_exists($key, $body)) {
            if ($required) {
                throw new HttpException(422, "Veld '{$key}' is verplicht");
            }
            return null;
        }
        if (!is_string($body[$key])) {
            throw new HttpException(422, "Veld '{$key}' moet tekst zijn");
        }
        $value = trim($body[$key]);
        $len = mb_strlen($value);
        if ($len < $min || $len > $max) {
            throw new HttpException(422, "Veld '{$key}' moet {$min}-{$max} tekens zijn");
        }
        return $value;
    }

    /** @param array<string, mixed> $body */
    public static function int(array $body, string $key, int $min, int $max, bool $required = false): ?int
    {
        if (!array_key_exists($key, $body)) {
            if ($required) {
                throw new HttpException(422, "Veld '{$key}' is verplicht");
            }
            return null;
        }
        $value = $body[$key];
        if (is_string($value) && preg_match('/^-?\d{1,9}$/', $value) === 1) {
            $value = (int) $value;
        }
        if (!is_int($value) || $value < $min || $value > $max) {
            throw new HttpException(422, "Veld '{$key}' moet een getal van {$min} t/m {$max} zijn");
        }
        return $value;
    }

    /**
     * @param array<string, mixed> $body
     * @return list<mixed>|null
     */
    public static function list(array $body, string $key, int $maxItems): ?array
    {
        if (!array_key_exists($key, $body)) {
            return null;
        }
        if (!is_array($body[$key]) || !array_is_list($body[$key])) {
            throw new HttpException(422, "Veld '{$key}' moet een lijst zijn");
        }
        if (count($body[$key]) > $maxItems) {
            throw new HttpException(422, "Veld '{$key}' mag maximaal {$maxItems} items bevatten");
        }
        return $body[$key];
    }
}
