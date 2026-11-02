<?php

declare(strict_types=1);

namespace App\Database;

use App\Config\Config;
use PDO;
use PDOException;
use RuntimeException;

/** Levert de gedeelde PDO-verbinding. Gebruik uitsluitend prepared statements. */
final class Database
{
    private static ?PDO $connection = null;
    private static ?Config $config = null;

    public static function configure(Config $config): void
    {
        self::$config = $config;
        self::$connection = null;
    }

    public static function getConnection(): PDO
    {
        if (self::$connection !== null) {
            return self::$connection;
        }

        $config = self::$config ?? Config::fromEnv();
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $config->dbHost,
            $config->dbPort,
            $config->dbName
        );

        try {
            self::$connection = new PDO($dsn, $config->dbUser, $config->dbPass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ]);
            // Versie-onafhankelijk (PDO::MYSQL_ATTR_INIT_COMMAND is deprecated vanaf PHP 8.5)
            self::$connection->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'");
        } catch (PDOException $e) {
            // Geen DSN/credentials in de melding
            throw new RuntimeException('Databaseverbinding mislukt', 0, $e);
        }

        return self::$connection;
    }
}
