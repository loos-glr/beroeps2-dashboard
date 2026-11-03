<?php

declare(strict_types=1);

namespace App\Services;

use App\Config\Config;
use Closure;
use PDO;

/** Globale lijst met GitHub-accounts (docenten) die nooit als student meetellen: .env + database. */
final class ExcludedAccountService
{
    /** @var list<string>|null */
    private ?array $cache = null;

    /** @param Closure(): PDO $db */
    public function __construct(private readonly Closure $db, private readonly Config $config)
    {
    }

    /** @return list<string> */
    private function stored(): array
    {
        $rows = ($this->db)()->query('SELECT identifier FROM excluded_github_accounts ORDER BY identifier')->fetchAll(PDO::FETCH_COLUMN);
        return array_map('strval', $rows);
    }

    /** @return list<string> unie van .env en database */
    public function identifiers(): array
    {
        return $this->cache ??= array_values(array_unique(array_merge($this->config->excludedGithubAccounts, $this->stored())));
    }

    /** @return list<array{identifier: string, source: string}> */
    public function list(): array
    {
        $out = [];
        foreach ($this->config->excludedGithubAccounts as $id) {
            $out[$id] = ['identifier' => $id, 'source' => 'env'];
        }
        foreach ($this->stored() as $id) {
            $out[$id] ??= ['identifier' => $id, 'source' => 'db'];
        }
        return array_values($out);
    }

    /**
     * Vervangt de volledige database-set; accounts uit .env blijven los daarvan altijd uitgesloten.
     *
     * @param list<string> $identifiers genormaliseerd
     * @return list<array{identifier: string, source: string}>
     */
    public function replace(array $identifiers): array
    {
        $pdo = ($this->db)();
        $pdo->beginTransaction();
        try {
            $pdo->exec('DELETE FROM excluded_github_accounts');
            $ins = $pdo->prepare('INSERT INTO excluded_github_accounts (identifier) VALUES (:i)');
            foreach (array_diff($identifiers, $this->config->excludedGithubAccounts) as $id) {
                $ins->execute(['i' => $id]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        $this->cache = null;
        return $this->list();
    }
}
