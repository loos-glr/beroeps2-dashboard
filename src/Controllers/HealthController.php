<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database\Database;
use Throwable;

final class HealthController
{
    /** @return array<string, string> */
    public function show(): array
    {
        try {
            Database::getConnection()->query('SELECT 1');
            $db = 'ok';
        } catch (Throwable) {
            $db = 'error';
        }
        return ['status' => 'ok', 'php' => PHP_VERSION, 'db' => $db];
    }
}
