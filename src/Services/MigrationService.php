<?php

declare(strict_types=1);

namespace App\Services;

use App\Http\HttpException;
use Closure;
use PDO;
use PDOException;
use Throwable;

/**
 * Importeert het JSON-exportbestand van de POC (teams + aliases) in één klas.
 *
 * parse() is puur (geen DB); import() draait alles in één transactie en is idempotent.
 */
final class MigrationService
{
    public const MAX_BODY_BYTES = 1048576;
    public const MAX_TEAMS = 200;
    public const MAX_ALIASES = 2000;
    public const MAX_EXPECTED = 100;
    public const MAX_GROUP_HANDLES = 20;
    public const MAX_TEXT = 255;
    public const MAX_WARNINGS = 100;

    /** @param Closure(): PDO $db */
    public function __construct(private readonly Closure $db)
    {
    }

    /* ===== Parsen (puur) ===== */

    /**
     * @return array{
     *   format: string,
     *   teams: list<array{name: string, repo: string, expected: list<string>}>,
     *   groups: list<array{fullName: string, handles: list<string>}>,
     *   warnings: list<array<string, mixed>>
     * }
     */
    public static function parse(mixed $data): array
    {
        $warnings = [];
        $teamsRaw = [];
        $aliasesRaw = [];

        if (!is_array($data) || $data === []) {
            throw new HttpException(422, 'Onbekend importformaat');
        }
        if (array_is_list($data)) {
            $format = 'v1';
            $teamsRaw = $data;
        } else {
            if (!array_key_exists('teams', $data) && !array_key_exists('aliases', $data)) {
                throw new HttpException(422, 'Onbekend importformaat');
            }
            if (array_key_exists('version', $data) && !in_array($data['version'], [1, 2], true)) {
                throw new HttpException(422, 'Onbekend importformaat (versie wordt niet ondersteund)');
            }
            $format = 'v2';
            if (array_key_exists('teams', $data)) {
                if (!is_array($data['teams']) || !array_is_list($data['teams'])) {
                    throw new HttpException(422, "Veld 'teams' moet een lijst zijn");
                }
                $teamsRaw = $data['teams'];
            }
            if (array_key_exists('aliases', $data)) {
                if (!is_array($data['aliases']) || ($data['aliases'] !== [] && array_is_list($data['aliases']))) {
                    throw new HttpException(422, "Veld 'aliases' moet een object zijn");
                }
                $aliasesRaw = $data['aliases'];
            }
        }

        if (count($teamsRaw) > self::MAX_TEAMS) {
            throw new HttpException(422, 'Maximaal ' . self::MAX_TEAMS . ' teams per import');
        }
        if (count($aliasesRaw) > self::MAX_ALIASES) {
            throw new HttpException(422, 'Maximaal ' . self::MAX_ALIASES . ' aliassen per import');
        }

        return [
            'format' => $format,
            'teams' => self::parseTeams($teamsRaw, $warnings),
            'groups' => self::parseAliases($aliasesRaw, $warnings),
            'warnings' => $warnings,
        ];
    }

    /**
     * @param list<mixed> $items
     * @param list<array<string, mixed>> $warnings
     * @return list<array{name: string, repo: string, expected: list<string>}>
     */
    private static function parseTeams(array $items, array &$warnings): array
    {
        $teams = [];
        foreach ($items as $i => $item) {
            if (!is_array($item) || array_is_list($item)) {
                $warnings[] = self::warn('invalid_team', "Team #{$i} is geen object en is overgeslagen", ['index' => $i]);
                continue;
            }
            $rawRepo = $item['repo'] ?? $item['repoFullName'] ?? null;
            $repo = is_string($rawRepo) ? GitHubIdentifier::normalizeRepo($rawRepo) : null;
            if ($repo === null) {
                $warnings[] = self::warn('invalid_repo', "Team #{$i} heeft geen geldige repository en is overgeslagen", ['index' => $i, 'repo' => $rawRepo]);
                continue;
            }
            $rawName = $item['name'] ?? $item['teamName'] ?? '';
            $name = is_string($rawName) ? trim($rawName) : '';
            $named = $name !== '';
            if (!$named) {
                $name = $repo;
            }
            if (mb_strlen($name) > self::MAX_TEXT) {
                $warnings[] = self::warn('too_long', "Teamnaam van {$repo} is te lang en het team is overgeslagen", ['repo' => $repo]);
                continue;
            }

            $expected = [];
            if (array_key_exists('expectedMembers', $item)) {
                $list = $item['expectedMembers'];
                if (!is_array($list) || !array_is_list($list)) {
                    $warnings[] = self::warn('invalid_team', "expectedMembers van {$repo} is geen lijst en is genegeerd", ['repo' => $repo]);
                } elseif (count($list) > self::MAX_EXPECTED) {
                    throw new HttpException(422, "Team {$repo}: maximaal " . self::MAX_EXPECTED . ' expectedMembers');
                } else {
                    foreach (GitHubIdentifier::normalizeList($list) as $h) {
                        if (mb_strlen($h) > self::MAX_TEXT) {
                            $warnings[] = self::warn('too_long', "Een verwacht lid van {$repo} is te lang en overgeslagen", ['repo' => $repo]);
                            continue;
                        }
                        $expected[] = $h;
                    }
                }
            }

            $key = mb_strtolower($repo);
            if (isset($teams[$key])) {
                $warnings[] = self::warn('duplicate_repo', "Repository {$repo} staat meerdere keren in het bestand en is samengevoegd", ['repo' => $repo]);
                if ($named) {
                    $teams[$key]['name'] = $name;     // een naamloos duplicaat overschrijft geen echte naam
                }
                $teams[$key]['expected'] = array_values(array_unique([...$teams[$key]['expected'], ...$expected]));
                continue;
            }
            $teams[$key] = ['name' => $name, 'repo' => $repo, 'expected' => $expected];
        }
        return array_values($teams);
    }

    /**
     * @param array<int|string, mixed> $aliases
     * @param list<array<string, mixed>> $warnings
     * @return list<array{fullName: string, handles: list<string>}>
     */
    private static function parseAliases(array $aliases, array &$warnings): array
    {
        // Eerst per genormaliseerde handle: de laatste waarde wint
        $byHandle = [];
        foreach ($aliases as $rawHandle => $rawName) {
            $handle = GitHubIdentifier::normalize((string) $rawHandle);
            $name = is_string($rawName) ? trim($rawName) : '';
            if ($handle === '' || $name === '') {
                $warnings[] = self::warn('invalid_alias', 'Alias met lege handle of naam is overgeslagen', ['handle' => (string) $rawHandle]);
                continue;
            }
            if (mb_strlen($handle) > self::MAX_TEXT || mb_strlen($name) > self::MAX_TEXT) {
                $warnings[] = self::warn('too_long', 'Alias met te lange handle of naam is overgeslagen', ['handle' => mb_substr($handle, 0, 60)]);
                continue;
            }
            if (isset($byHandle[$handle])) {
                $warnings[] = self::warn('duplicate_handle', "Handle {$handle} komt meerdere keren voor; de laatste naam geldt", ['handle' => $handle]);
            }
            $byHandle[$handle] = $name;
        }

        // Groeperen op naam (trim + lowercase), net als groupAliasesByName in de POC
        $groups = [];
        foreach ($byHandle as $handle => $name) {
            $key = mb_strtolower($name);
            $groups[$key] ??= ['fullName' => $name, 'handles' => []];
            $groups[$key]['handles'][] = (string) $handle;
        }
        ksort($groups, SORT_STRING);

        $out = [];
        foreach ($groups as $group) {
            if (count($group['handles']) > self::MAX_GROUP_HANDLES) {
                $warnings[] = self::warn(
                    'too_many_handles_in_group',
                    "Naam '{$group['fullName']}' heeft meer dan " . self::MAX_GROUP_HANDLES . ' handles; groep overgeslagen',
                    ['fullName' => $group['fullName'], 'handleCount' => count($group['handles'])]
                );
                continue;
            }
            sort($group['handles'], SORT_STRING);
            $out[] = $group;
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $item
     * @return array<string, mixed>
     */
    private static function warn(string $code, string $message, array $item = []): array
    {
        return ['code' => $code, 'message' => $message, 'item' => $item];
    }

    /* ===== Importeren (transactie) ===== */

    /**
     * @param array{format: string, teams: list<array<string, mixed>>, groups: list<array<string, mixed>>, warnings: list<array<string, mixed>>} $plan
     * @return array<string, mixed>
     */
    public function import(int $contextId, array $plan, bool $dryRun): array
    {
        for ($attempt = 1;; $attempt++) {
            try {
                return $this->importOnce($contextId, $plan, $dryRun);
            } catch (PDOException $e) {
                $code = $e->errorInfo[1] ?? 0;
                if ($code === 1213 && $attempt < 2) {      // deadlock: één keer opnieuw
                    continue;
                }
                throw $code === 1062
                    ? new HttpException(409, 'Import botste met een gelijktijdige wijziging, probeer opnieuw')
                    : $e;
            }
        }
    }

    /** @return array<string, mixed> */
    private function importOnce(int $contextId, array $plan, bool $dryRun): array
    {
        $pdo = ($this->db)();
        $warnings = $plan['warnings'];
        $s = [
            'teamsCreated' => 0, 'teamsUpdated' => 0, 'teamsUnchanged' => 0, 'expectedMembersAdded' => 0,
            'studentsCreated' => 0, 'studentsUpdated' => 0, 'studentsUnchanged' => 0,
            'handlesLinked' => 0, 'handlesMoved' => 0, 'studentsMergedAway' => 0,
        ];
        $teamRows = [];
        $studentRows = [];
        $moved = [];

        $pdo->beginTransaction();
        try {
            $lock = $pdo->prepare('SELECT id FROM academic_contexts WHERE id = :id FOR UPDATE');
            $lock->execute(['id' => $contextId]);
            if ($lock->fetchColumn() === false) {
                throw new HttpException(404, 'Klas niet gevonden');
            }

            /* --- Teams --- */
            $existing = $pdo->prepare('SELECT id, team_name, repo_full_name FROM teams WHERE context_id = :c FOR UPDATE');
            $existing->execute(['c' => $contextId]);
            $byRepo = [];
            foreach ($existing->fetchAll() as $r) {
                $byRepo[mb_strtolower($r['repo_full_name'])] = $r;
            }
            $insTeam = $pdo->prepare('INSERT INTO teams (context_id, team_name, repo_full_name) VALUES (:c, :n, :r)');
            $updTeam = $pdo->prepare('UPDATE teams SET team_name = :n WHERE id = :id');
            $insExp = $pdo->prepare('INSERT IGNORE INTO team_expected_members (team_id, github_identifier) VALUES (:t, :g)');

            foreach ($plan['teams'] as $t) {
                $row = $byRepo[mb_strtolower($t['repo'])] ?? null;
                if ($row === null) {
                    $insTeam->execute(['c' => $contextId, 'n' => $t['name'], 'r' => $t['repo']]);
                    $teamId = (int) $pdo->lastInsertId();
                    $action = 'created';
                    $s['teamsCreated']++;
                } else {
                    $teamId = (int) $row['id'];
                    if ($row['team_name'] !== $t['name']) {
                        $updTeam->execute(['n' => $t['name'], 'id' => $teamId]);
                        $action = 'updated';
                        $s['teamsUpdated']++;
                    } else {
                        $action = 'unchanged';
                        $s['teamsUnchanged']++;
                    }
                }
                foreach ($t['expected'] as $handle) {
                    $insExp->execute(['t' => $teamId, 'g' => $handle]);
                    $s['expectedMembersAdded'] += $insExp->rowCount();
                }
                $teamRows[] = [
                    'id' => $dryRun && $action === 'created' ? null : $teamId,
                    'repo' => $row['repo_full_name'] ?? $t['repo'],
                    'teamName' => $t['name'],
                    'action' => $action,
                ];
            }

            /* --- Studenten --- */
            $this->importStudents($pdo, $plan['groups'], $s, $studentRows, $moved, $warnings, $dryRun);

            $dryRun ? $pdo->rollBack() : $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        $truncated = count($warnings) > self::MAX_WARNINGS;
        return [
            'dryRun' => $dryRun,
            'contextId' => $contextId,
            'format' => $plan['format'],
            'summary' => $s,
            'teams' => $teamRows,
            'students' => $studentRows,
            'handlesMoved' => $moved,
            'warnings' => array_slice($warnings, 0, self::MAX_WARNINGS),
            'warningsTruncated' => $truncated,
        ];
    }

    /**
     * @param list<array<string, mixed>> $groups
     * @param array<string, int> $s
     * @param list<array<string, mixed>> $rows
     * @param list<array<string, mixed>> $moved
     * @param list<array<string, mixed>> $warnings
     */
    private function importStudents(PDO $pdo, array $groups, array &$s, array &$rows, array &$moved, array &$warnings, bool $dryRun): void
    {
        $all = [];
        foreach ($groups as $g) {
            array_push($all, ...$g['handles']);
        }
        if ($all === []) {
            return;
        }

        // Alle bestaande koppelingen in één keer vergrendelen: handle => student_id
        $in = implode(',', array_fill(0, count($all), '?'));
        $stmt = $pdo->prepare("SELECT github_identifier, student_id FROM student_github_accounts WHERE github_identifier IN ({$in}) FOR UPDATE");
        $stmt->execute($all);
        $owner = [];
        foreach ($stmt->fetchAll() as $r) {
            $owner[$r['github_identifier']] = (int) $r['student_id'];
        }

        $insStudent = $pdo->prepare('INSERT INTO students (full_name) VALUES (:n)');
        $link = $pdo->prepare('INSERT INTO student_github_accounts (student_id, github_identifier) VALUES (:s, :g)');
        $move = $pdo->prepare('UPDATE student_github_accounts SET student_id = :s WHERE github_identifier = :g');
        $count = $pdo->prepare('SELECT COUNT(*) FROM student_github_accounts WHERE student_id = :s');
        $info = $pdo->prepare('SELECT full_name, notes, student_number FROM students WHERE id = :s');
        $drop = $pdo->prepare('DELETE FROM students WHERE id = :s');

        foreach ($groups as $g) {
            $owners = [];
            foreach ($g['handles'] as $h) {
                if (isset($owner[$h])) {
                    $owners[$owner[$h]] = true;
                }
            }
            $ids = array_keys($owners);
            sort($ids);

            if ($ids === []) {
                $insStudent->execute(['n' => $g['fullName']]);
                $target = (int) $pdo->lastInsertId();
                foreach ($g['handles'] as $h) {
                    $link->execute(['s' => $target, 'g' => $h]);
                    $owner[$h] = $target;
                    $s['handlesLinked']++;
                }
                $s['studentsCreated']++;
                $rows[] = ['id' => $dryRun ? null : $target, 'fullName' => $g['fullName'], 'handles' => $g['handles'], 'action' => 'created'];
                continue;
            }

            $target = $ids[0];     // laagste id: deterministisch, dus idempotent
            $changed = false;
            foreach ($g['handles'] as $h) {
                if (!isset($owner[$h])) {
                    $link->execute(['s' => $target, 'g' => $h]);
                    $s['handlesLinked']++;
                    $changed = true;
                } elseif ($owner[$h] !== $target) {
                    $move->execute(['s' => $target, 'g' => $h]);
                    $moved[] = ['handle' => $h, 'fromStudentId' => $owner[$h], 'toStudentId' => $target];
                    $s['handlesMoved']++;
                    $changed = true;
                }
                $owner[$h] = $target;
            }

            // Overgenomen studenten zonder accounts: lege schillen opruimen, notities/nummers bewaren
            foreach (array_slice($ids, 1) as $old) {
                $count->execute(['s' => $old]);
                if ((int) $count->fetchColumn() > 0) {
                    continue;
                }
                $info->execute(['s' => $old]);
                $row = $info->fetch();
                if ($row !== false && trim((string) $row['notes']) === '' && $row['student_number'] === null) {
                    $drop->execute(['s' => $old]);
                    $s['studentsMergedAway']++;
                } else {
                    $warnings[] = self::warn('kept_orphan', "Student #{$old} heeft geen accounts meer maar bevat notities of een studentnummer en is bewaard", ['studentId' => $old]);
                }
            }

            $info->execute(['s' => $target]);
            $dbName = (string) ($info->fetch()['full_name'] ?? '');
            if (mb_strtolower(trim($dbName)) !== mb_strtolower($g['fullName'])) {
                $warnings[] = self::warn(
                    'name_differs',
                    "Student #{$target} heet in de database '{$dbName}' en blijft zo; het bestand zegt '{$g['fullName']}'",
                    ['studentId' => $target, 'dbName' => $dbName, 'importName' => $g['fullName']]
                );
            }

            $changed ? $s['studentsUpdated']++ : $s['studentsUnchanged']++;
            $rows[] = ['id' => $target, 'fullName' => $dbName, 'handles' => $g['handles'], 'action' => $changed ? 'updated' : 'unchanged'];
        }
    }
}
