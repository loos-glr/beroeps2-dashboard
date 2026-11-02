<?php

declare(strict_types=1);

namespace App\Services;

use App\Http\HttpException;
use Closure;
use PDO;
use PDOException;

/** CRUD voor academic_contexts (schooljaar + vak + klas). */
final class ContextService
{
    private const COLUMNS = ['school_year', 'course_code', 'class_name', 'inactivity_threshold_days', 'cache_ttl_minutes', 'sprint_start_date'];

    /** @param Closure(): PDO $db */
    public function __construct(private readonly Closure $db)
    {
    }

    /** @param array<string, mixed> $row */
    public static function map(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'schoolYear' => $row['school_year'],
            'courseCode' => $row['course_code'],
            'className' => $row['class_name'],
            'inactivityThresholdDays' => (int) $row['inactivity_threshold_days'],
            'cacheTtlMinutes' => (int) $row['cache_ttl_minutes'],
            'sprintStartDate' => $row['sprint_start_date'] ?? null,
            'teamCount' => isset($row['team_count']) ? (int) $row['team_count'] : null,
            'createdAt' => Dates::fromDb($row['created_at']),
        ];
    }

    /** @return list<array<string, mixed>> */
    public function list(): array
    {
        $rows = ($this->db)()->query(
            'SELECT c.*, COUNT(t.id) AS team_count
             FROM academic_contexts c LEFT JOIN teams t ON t.context_id = c.id
             GROUP BY c.id ORDER BY c.school_year DESC, c.course_code, c.class_name'
        )->fetchAll();
        return array_map(self::map(...), $rows);
    }

    /** @return array<string, mixed> */
    public function find(int $id): array
    {
        $stmt = ($this->db)()->prepare(
            'SELECT c.*, (SELECT COUNT(*) FROM teams t WHERE t.context_id = c.id) AS team_count
             FROM academic_contexts c WHERE c.id = :id'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if ($row === false) {
            throw new HttpException(404, 'Klas niet gevonden');
        }
        return self::map($row);
    }

    /**
     * @param array<string, scalar> $cols kolomnaam => waarde (alleen meegegeven kolommen)
     * @return array<string, mixed>
     */
    public function create(array $cols): array
    {
        $cols = array_intersect_key($cols, array_flip(self::COLUMNS));
        $names = array_keys($cols);
        $pdo = ($this->db)();
        try {
            $pdo->prepare(
                'INSERT INTO academic_contexts (' . implode(',', $names) . ') VALUES (:' . implode(',:', $names) . ')'
            )->execute($cols);
        } catch (PDOException $e) {
            throw $this->translate($e);
        }
        return $this->find((int) $pdo->lastInsertId());
    }

    /**
     * @param array<string, scalar> $cols
     * @return array<string, mixed>
     */
    public function update(int $id, array $cols): array
    {
        $cols = array_intersect_key($cols, array_flip(self::COLUMNS));
        $pdo = ($this->db)();
        $pdo->beginTransaction();
        try {
            // Bestaanscontrole los van rowCount(), dat is 0 bij ongewijzigde waarden
            $lock = $pdo->prepare('SELECT id FROM academic_contexts WHERE id = :id FOR UPDATE');
            $lock->execute(['id' => $id]);
            if ($lock->fetchColumn() === false) {
                throw new HttpException(404, 'Klas niet gevonden');
            }
            if ($cols !== []) {
                $set = implode(', ', array_map(static fn (string $c): string => "{$c} = :{$c}", array_keys($cols)));
                $pdo->prepare("UPDATE academic_contexts SET {$set} WHERE id = :__id")->execute($cols + ['__id' => $id]);
            }
            $pdo->commit();
        } catch (PDOException $e) {
            $pdo->rollBack();
            throw $this->translate($e);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return $this->find($id);
    }

    private function translate(PDOException $e): \Throwable
    {
        return ($e->errorInfo[1] ?? 0) === 1062
            ? new HttpException(409, 'Deze klas bestaat al voor dit schooljaar en vak')
            : $e;
    }
}
