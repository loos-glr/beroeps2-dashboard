<?php

declare(strict_types=1);

namespace App\Services;

use App\Http\HttpException;
use Closure;
use DateTimeImmutable;
use PDO;
use Throwable;

/** Lesronde-logboek (coaching_logs): bezoeken, notities en opvolgafspraken per team en student. */
final class CoachingLogService
{
    public const DEFAULT_NOTE = 'Besproken tijdens lesronde';

    /** @param Closure(): PDO $db */
    public function __construct(private readonly Closure $db)
    {
    }

    private const SELECT = 'SELECT l.id, l.context_id, l.team_id, l.student_id, s.full_name, l.note_text, l.follow_up_date,
                                   l.is_resolved, l.visited_at
                            FROM coaching_logs l LEFT JOIN students s ON s.id = l.student_id';

    /** @param array<string, mixed> $r */
    private static function map(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'contextId' => (int) $r['context_id'],
            'teamId' => $r['team_id'] === null ? null : (int) $r['team_id'],
            'studentId' => $r['student_id'] === null ? null : (int) $r['student_id'],
            'studentName' => $r['full_name'],
            'noteText' => $r['note_text'],
            'followUpDate' => $r['follow_up_date'],
            'isResolved' => (int) $r['is_resolved'] === 1,
            'visitedAt' => Dates::fromDb($r['visited_at']),
        ];
    }

    /** @return list<array<string, mixed>> */
    public function list(int $contextId): array
    {
        (new ContextService($this->db))->find($contextId);
        $stmt = ($this->db)()->prepare(self::SELECT . ' WHERE l.context_id = :c ORDER BY l.visited_at DESC, l.id DESC');
        $stmt->execute(['c' => $contextId]);
        return array_map(self::map(...), $stmt->fetchAll());
    }

    /** @return array<string, mixed> */
    public function find(int $id): array
    {
        $stmt = ($this->db)()->prepare(self::SELECT . ' WHERE l.id = :id');
        $stmt->execute(['id' => $id]);
        $r = $stmt->fetch();
        if ($r === false) {
            throw new HttpException(404, 'Logregel niet gevonden');
        }
        return self::map($r);
    }

    /**
     * @param array{teamId?: ?int, studentId?: ?int, githubIdentifier?: ?string, fullName?: ?string,
     *              noteText?: ?string, followUpDate?: ?string, resolveDue?: bool} $input
     * @return array{log: array<string, mixed>, student: ?array<string, mixed>, resolvedIds: list<int>, summaries: array<string, mixed>}
     */
    public function create(int $contextId, array $input, ?DateTimeImmutable $now = null): array
    {
        $now ??= Dates::now();
        (new ContextService($this->db))->find($contextId);
        $pdo = ($this->db)();

        $teamId = $input['teamId'] ?? null;
        if ($teamId !== null) {
            $q = $pdo->prepare('SELECT 1 FROM teams WHERE id = :t AND context_id = :c');
            $q->execute(['t' => $teamId, 'c' => $contextId]);
            if ($q->fetchColumn() === false) {
                throw new HttpException(422, 'Team hoort niet bij deze klas');
            }
        }

        [$studentId, $student] = $this->resolveStudent($input);
        if ($teamId === null && $studentId === null) {
            throw new HttpException(422, "Geef minimaal 'teamId', 'studentId' of 'githubIdentifier' op");
        }

        $note = trim((string) ($input['noteText'] ?? ''));
        $resolved = [];
        $pdo->beginTransaction();
        try {
            if (($input['resolveDue'] ?? false) === true) {
                $resolved = $this->resolveDue($contextId, $teamId, $studentId, $now);
            }
            $pdo->prepare(
                'INSERT INTO coaching_logs (context_id, team_id, student_id, note_text, follow_up_date, visited_at)
                 VALUES (:c, :t, :s, :n, :d, :v)'
            )->execute([
                'c' => $contextId, 't' => $teamId, 's' => $studentId,
                'n' => $note === '' ? self::DEFAULT_NOTE : $note,
                'd' => $input['followUpDate'] ?? null,
                'v' => $now->format('Y-m-d H:i:s'),
            ]);
            $id = (int) $pdo->lastInsertId();
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        return [
            'log' => $this->find($id),
            'student' => $student,
            'resolvedIds' => $resolved,
            'summaries' => $this->summaries($contextId, $now),
        ];
    }

    /**
     * @param array{isResolved?: bool, noteText?: string, followUpDate?: ?string} $fields alleen meegegeven velden
     * @return array{log: array<string, mixed>, summaries: array<string, mixed>}
     */
    public function update(int $id, array $fields): array
    {
        $log = $this->find($id);
        $set = [];
        $params = ['id' => $id];
        if (array_key_exists('isResolved', $fields)) {
            $set[] = 'is_resolved = :r';
            $params['r'] = $fields['isResolved'] ? 1 : 0;
        }
        if (array_key_exists('noteText', $fields)) {
            $set[] = 'note_text = :n';
            $params['n'] = $fields['noteText'];
        }
        if (array_key_exists('followUpDate', $fields)) {
            $set[] = 'follow_up_date = :d';
            $params['d'] = $fields['followUpDate'];
        }
        if ($set !== []) {
            ($this->db)()->prepare('UPDATE coaching_logs SET ' . implode(', ', $set) . ' WHERE id = :id')->execute($params);
        }
        return ['log' => $this->find($id), 'summaries' => $this->summaries($log['contextId'])];
    }

    /** @return array{summaries: array<string, mixed>} */
    public function delete(int $id): array
    {
        $log = $this->find($id);
        ($this->db)()->prepare('DELETE FROM coaching_logs WHERE id = :id')->execute(['id' => $id]);
        return ['summaries' => $this->summaries($log['contextId'])];
    }

    /** @return array{teams: array<int, array<string, mixed>>, students: array<int, array<string, mixed>>} */
    public function summaries(int $contextId, ?DateTimeImmutable $now = null): array
    {
        $stmt = ($this->db)()->prepare(
            'SELECT team_id, student_id, follow_up_date, is_resolved, visited_at FROM coaching_logs WHERE context_id = :c'
        );
        $stmt->execute(['c' => $contextId]);
        return self::summarize($stmt->fetchAll(), $now ?? Dates::now());
    }

    /**
     * Pure samenvatting per team en per student. 'Vandaag' en 'te laat' volgen de dagwisseling in Europe/Amsterdam.
     * openFollowUps telt alleen afspraken mét datum: een snelle "besproken"-vink is geen openstaande afspraak.
     *
     * @param list<array<string, mixed>> $rows team_id, student_id, follow_up_date, is_resolved, visited_at (UTC)
     * @return array{teams: array<int, array<string, mixed>>, students: array<int, array<string, mixed>>}
     */
    public static function summarize(array $rows, DateTimeImmutable $now): array
    {
        $todayFrom = Dates::periodStart('today', null, $now)['from']?->format('Y-m-d H:i:s');
        $today = Dates::localToday($now);
        $out = ['teams' => [], 'students' => []];

        foreach ($rows as $r) {
            $open = $r['follow_up_date'] !== null && (int) $r['is_resolved'] === 0;
            $due = $open && (string) $r['follow_up_date'] <= $today;
            $visited = (string) $r['visited_at'] >= (string) $todayFrom;
            foreach ([['teams', $r['team_id']], ['students', $r['student_id']]] as [$bucket, $key]) {
                if ($key === null) {
                    continue;
                }
                $s = &$out[$bucket][(int) $key];
                $s ??= self::emptySummary();
                $s['logCount']++;
                $s['visitedToday'] = $s['visitedToday'] || $visited;
                $s['openFollowUps'] += $open ? 1 : 0;
                $s['dueFollowUps'] += $due ? 1 : 0;
                unset($s);
            }
        }
        return $out;
    }

    /** @return array{visitedToday: bool, openFollowUps: int, dueFollowUps: int, logCount: int} */
    public static function emptySummary(): array
    {
        return ['visitedToday' => false, 'openFollowUps' => 0, 'dueFollowUps' => 0, 'logCount' => 0];
    }

    /**
     * Zet alle verlopen open afspraken van dit team (zonder student) of deze student op afgerond.
     *
     * @return list<int>
     */
    private function resolveDue(int $contextId, ?int $teamId, ?int $studentId, DateTimeImmutable $now): array
    {
        $where = $studentId !== null ? 'student_id = :k' : 'team_id = :k AND student_id IS NULL';
        $params = ['c' => $contextId, 'k' => $studentId ?? $teamId, 'd' => Dates::localToday($now)];
        $pdo = ($this->db)();
        $ids = $pdo->prepare(
            "SELECT id FROM coaching_logs WHERE context_id = :c AND is_resolved = 0 AND follow_up_date IS NOT NULL
             AND follow_up_date <= :d AND {$where} FOR UPDATE"
        );
        $ids->execute($params);
        $list = array_map('intval', $ids->fetchAll(PDO::FETCH_COLUMN));
        if ($list !== []) {
            $in = implode(',', array_fill(0, count($list), '?'));
            $pdo->prepare("UPDATE coaching_logs SET is_resolved = 1 WHERE id IN ({$in})")->execute($list);
        }
        return $list;
    }

    /**
     * Bepaalt de student: expliciet id, of via GitHub-handle (bestaande koppeling, anders een nieuw basisrecord).
     *
     * @param array<string, mixed> $input
     * @return array{0: ?int, 1: ?array<string, mixed>} [studentId, studentrecord indien via handle bepaald]
     */
    private function resolveStudent(array $input): array
    {
        $students = new StudentIdentityService($this->db);
        $studentId = $input['studentId'] ?? null;
        if ($studentId !== null) {
            $students->find($studentId);      // 404 als hij niet bestaat
            return [$studentId, null];
        }
        $handle = GitHubIdentifier::normalize((string) ($input['githubIdentifier'] ?? ''));
        if ($handle === '') {
            return [null, null];
        }
        $q = ($this->db)()->prepare('SELECT student_id FROM student_github_accounts WHERE github_identifier = :g');
        $q->execute(['g' => $handle]);
        $existing = $q->fetchColumn();
        if ($existing !== false) {
            return [(int) $existing, $students->find((int) $existing)];
        }
        $name = trim((string) ($input['fullName'] ?? ''));
        $res = $students->upsert(null, ['fullName' => $name === '' ? $handle : $name], [$handle]);
        return [(int) $res['student']['id'], $res['student']];
    }
}
