<?php

declare(strict_types=1);

namespace App\Services;

use App\Http\HttpException;
use Closure;
use PDO;
use PDOException;
use Throwable;

/** CRUD voor teams en hun verwachte leden (team_expected_members). */
final class TeamService
{
    /** @param Closure(): PDO $db */
    public function __construct(private readonly Closure $db, private readonly GitHubClientService $github)
    {
    }

    /** @return array<string, mixed> */
    public function find(int $id): array
    {
        $pdo = ($this->db)();
        $stmt = $pdo->prepare('SELECT * FROM teams WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if ($row === false) {
            throw new HttpException(404, 'Team niet gevonden');
        }
        $members = $pdo->prepare('SELECT github_identifier FROM team_expected_members WHERE team_id = :id ORDER BY github_identifier');
        $members->execute(['id' => $id]);

        return [
            'id' => (int) $row['id'],
            'contextId' => (int) $row['context_id'],
            'teamName' => $row['team_name'],
            'repoFullName' => $row['repo_full_name'],
            'expectedMembers' => $members->fetchAll(PDO::FETCH_COLUMN),
            'createdAt' => Dates::fromDb($row['created_at']),
        ];
    }

    /**
     * @param list<string> $expected genormaliseerde identifiers
     * @return array<string, mixed>
     */
    public function create(int $contextId, string $teamName, string $repo, array $expected): array
    {
        $pdo = ($this->db)();
        $exists = $pdo->prepare('SELECT 1 FROM academic_contexts WHERE id = :id');
        $exists->execute(['id' => $contextId]);
        if ($exists->fetchColumn() === false) {
            throw new HttpException(422, 'Onbekende klas (contextId)');
        }

        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO teams (context_id, team_name, repo_full_name) VALUES (:c, :n, :r)')
                ->execute(['c' => $contextId, 'n' => $teamName, 'r' => $repo]);
            $id = (int) $pdo->lastInsertId();
            $this->replaceExpected($id, $expected);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $this->translate($e);
        }
        return $this->find($id);
    }

    /**
     * @param array{teamName?: string, repoFullName?: string, expectedMembers?: list<string>} $fields
     * @return array<string, mixed>
     */
    public function update(int $id, array $fields): array
    {
        $pdo = ($this->db)();
        $oldRepo = null;
        $pdo->beginTransaction();
        try {
            $lock = $pdo->prepare('SELECT repo_full_name FROM teams WHERE id = :id FOR UPDATE');
            $lock->execute(['id' => $id]);
            $oldRepo = $lock->fetchColumn();
            if ($oldRepo === false) {
                throw new HttpException(404, 'Team niet gevonden');
            }

            if (isset($fields['teamName'])) {
                $pdo->prepare('UPDATE teams SET team_name = :n WHERE id = :id')->execute(['n' => $fields['teamName'], 'id' => $id]);
            }
            if (isset($fields['repoFullName']) && $fields['repoFullName'] !== $oldRepo) {
                $pdo->prepare('UPDATE teams SET repo_full_name = :r WHERE id = :id')->execute(['r' => $fields['repoFullName'], 'id' => $id]);
                // Gesyncte data van de oude repo mag niet blijven staan
                foreach (['repo_commits', 'repo_pull_requests', 'repo_issues', 'repo_collaborators'] as $table) {
                    $pdo->prepare("DELETE FROM {$table} WHERE team_id = :id")->execute(['id' => $id]);
                }
                $pdo->prepare(
                    'UPDATE teams SET last_synced_at = NULL, last_repo_pushed_at = NULL, collaborators_synced_at = NULL,
                       collaborators_detected = NULL, branch_count = 0, last_sync_cost = NULL WHERE id = :id'
                )->execute(['id' => $id]);
            }
            if (isset($fields['expectedMembers'])) {
                $this->replaceExpected($id, $fields['expectedMembers']);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $this->translate($e);
        }

        if (isset($fields['repoFullName']) && $oldRepo !== $fields['repoFullName']) {
            $this->forgetIfUnused((string) $oldRepo);
        }
        return $this->find($id);
    }

    public function delete(int $id): void
    {
        $pdo = ($this->db)();
        $stmt = $pdo->prepare('SELECT repo_full_name FROM teams WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $repo = $stmt->fetchColumn();
        if ($repo === false) {
            throw new HttpException(404, 'Team niet gevonden');
        }
        // FK-cascade ruimt de gesyncte data en verwachte leden op
        $pdo->prepare('DELETE FROM teams WHERE id = :id')->execute(['id' => $id]);
        $this->forgetIfUnused((string) $repo);
    }

    /** @param list<string> $expected */
    private function replaceExpected(int $teamId, array $expected): void
    {
        $pdo = ($this->db)();
        $pdo->prepare('DELETE FROM team_expected_members WHERE team_id = :t')->execute(['t' => $teamId]);
        if ($expected === []) {
            return;
        }
        $stmt = $pdo->prepare('INSERT IGNORE INTO team_expected_members (team_id, github_identifier) VALUES (:t, :g)');
        foreach ($expected as $handle) {
            $stmt->execute(['t' => $teamId, 'g' => $handle]);
        }
    }

    /** ETag-cache van een repo opruimen zodra geen enkel team die nog gebruikt. */
    private function forgetIfUnused(string $repo): void
    {
        $stmt = ($this->db)()->prepare('SELECT COUNT(*) FROM teams WHERE repo_full_name = :r');
        $stmt->execute(['r' => $repo]);
        if ((int) $stmt->fetchColumn() === 0) {
            $this->github->forgetRepo($repo);
        }
    }

    private function translate(Throwable $e): Throwable
    {
        return ($e instanceof PDOException && ($e->errorInfo[1] ?? 0) === 1062)
            ? new HttpException(409, 'Deze repository is al toegevoegd aan deze klas')
            : $e;
    }
}
