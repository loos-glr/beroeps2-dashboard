<?php

declare(strict_types=1);

namespace App\Services;

use App\Http\HttpException;
use Closure;
use PDO;
use PDOException;
use Throwable;

/** Studenten en hun gekoppelde GitHub-accounts (student_github_accounts). */
final class StudentIdentityService
{
    /** @param Closure(): PDO $db */
    public function __construct(private readonly Closure $db)
    {
    }

    /** @return list<array<string, mixed>> */
    public function list(string $q = ''): array
    {
        $sql = 'SELECT s.id, s.full_name, s.student_number, s.notes, s.created_at, a.github_identifier
                FROM students s LEFT JOIN student_github_accounts a ON a.student_id = s.id';
        $params = [];
        $q = trim($q);
        if ($q !== '') {
            $sql .= " WHERE s.full_name LIKE :q1 ESCAPE '|' OR s.student_number LIKE :q2 ESCAPE '|'
                      OR s.id IN (SELECT student_id FROM student_github_accounts WHERE github_identifier LIKE :q3 ESCAPE '|')";
            // Native prepares laten een named placeholder niet hergebruiken
            $like = '%' . str_replace(['|', '%', '_'], ['||', '|%', '|_'], $q) . '%';
            $params = ['q1' => $like, 'q2' => $like, 'q3' => $like];
        }
        $stmt = ($this->db)()->prepare($sql . ' ORDER BY s.full_name, s.id, a.github_identifier');
        $stmt->execute($params);

        $students = [];
        foreach ($stmt->fetchAll() as $r) {
            $id = (int) $r['id'];
            $students[$id] ??= [
                'id' => $id, 'fullName' => $r['full_name'], 'studentNumber' => $r['student_number'],
                'notes' => $r['notes'], 'handles' => [], 'createdAt' => Dates::fromDb($r['created_at']),
            ];
            if ($r['github_identifier'] !== null) {
                $students[$id]['handles'][] = $r['github_identifier'];
            }
        }
        return array_values($students);
    }

    /** @return array<string, mixed> */
    public function find(int $id): array
    {
        $stmt = ($this->db)()->prepare('SELECT id, full_name, student_number, notes, created_at FROM students WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $r = $stmt->fetch();
        if ($r === false) {
            throw new HttpException(404, 'Student niet gevonden');
        }
        return [
            'id' => (int) $r['id'], 'fullName' => $r['full_name'], 'studentNumber' => $r['student_number'],
            'notes' => $r['notes'], 'handles' => $this->handlesOf($id), 'createdAt' => Dates::fromDb($r['created_at']),
        ];
    }

    /** @return array{unlinkedHandles: list<string>} */
    public function delete(int $id): array
    {
        $pdo = ($this->db)();
        $exists = $pdo->prepare('SELECT 1 FROM students WHERE id = :id');
        $exists->execute(['id' => $id]);
        if ($exists->fetchColumn() === false) {
            throw new HttpException(404, 'Student niet gevonden');
        }
        $handles = $this->handlesOf($id);
        $pdo->prepare('DELETE FROM students WHERE id = :id')->execute(['id' => $id]);   // FK-cascade op accounts
        return ['unlinkedHandles' => $handles];
    }

    /**
     * Maakt een student aan of werkt die bij, en zet de accounts in één transactie.
     *
     * @param array{fullName?: string, studentNumber?: ?string, notes?: ?string} $fields alleen meegegeven velden
     * @param list<string>|null $handles volledige set (genormaliseerd); null = accounts ongemoeid laten
     * @return array<string, mixed>
     */
    public function upsert(?int $studentId, array $fields, ?array $handles): array
    {
        for ($attempt = 1;; $attempt++) {
            try {
                return $this->upsertOnce($studentId, $fields, $handles);
            } catch (PDOException $e) {
                $code = $e->errorInfo[1] ?? 0;
                if ($code === 1213 && $attempt < 2) {      // deadlock: één keer opnieuw
                    continue;
                }
                throw $code === 1062 ? new HttpException(409, 'Dit studentnummer of GitHub-account is al in gebruik') : $e;
            }
        }
    }

    /** @return array<string, mixed> */
    private function upsertOnce(?int $studentId, array $fields, ?array $handles): array
    {
        $pdo = ($this->db)();
        $created = false;
        $moved = [];
        $removed = [];
        $deleted = [];
        $kept = [];

        $pdo->beginTransaction();
        try {
            if ($studentId !== null) {
                $lock = $pdo->prepare('SELECT id FROM students WHERE id = :id FOR UPDATE');
                $lock->execute(['id' => $studentId]);
                if ($lock->fetchColumn() === false) {
                    throw new HttpException(404, 'Student niet gevonden');
                }
                $cols = ['fullName' => 'full_name', 'studentNumber' => 'student_number', 'notes' => 'notes'];
                $set = [];
                $params = ['id' => $studentId];
                foreach ($cols as $key => $col) {
                    if (array_key_exists($key, $fields)) {
                        $set[] = "{$col} = :{$key}";
                        $params[$key] = $fields[$key];
                    }
                }
                if ($set !== []) {
                    $pdo->prepare('UPDATE students SET ' . implode(', ', $set) . ' WHERE id = :id')->execute($params);
                }
            } else {
                $name = $fields['fullName'] ?? ($handles[0] ?? null);
                if ($name === null || $name === '') {
                    throw new HttpException(422, "Veld 'fullName' of minimaal één handle is verplicht");
                }
                $pdo->prepare('INSERT INTO students (full_name, student_number, notes) VALUES (:n, :s, :t)')
                    ->execute(['n' => $name, 's' => $fields['studentNumber'] ?? null, 't' => $fields['notes'] ?? null]);
                $studentId = (int) $pdo->lastInsertId();
                $created = true;
            }

            if ($handles !== null) {
                $current = $pdo->prepare('SELECT github_identifier FROM student_github_accounts WHERE student_id = :s FOR UPDATE');
                $current->execute(['s' => $studentId]);
                $own = $current->fetchAll(PDO::FETCH_COLUMN);

                // Ontkoppelen: handles die niet meer in de set zitten (nooit een lege IN ())
                $removed = array_values(array_diff($own, $handles));
                if ($handles === []) {
                    $pdo->prepare('DELETE FROM student_github_accounts WHERE student_id = :s')->execute(['s' => $studentId]);
                } elseif ($removed !== []) {
                    $in = implode(',', array_fill(0, count($removed), '?'));
                    $pdo->prepare("DELETE FROM student_github_accounts WHERE student_id = ? AND github_identifier IN ({$in})")
                        ->execute([$studentId, ...$removed]);
                }

                $toLink = array_values(array_diff($handles, $own));
                $previousOwners = [];
                if ($toLink !== []) {
                    // Huidige eigenaars vergrendelen, zodat we weten van wie een handle wordt overgenomen
                    $in = implode(',', array_fill(0, count($toLink), '?'));
                    $owners = $pdo->prepare("SELECT github_identifier, student_id FROM student_github_accounts WHERE github_identifier IN ({$in}) FOR UPDATE");
                    $owners->execute($toLink);
                    foreach ($owners->fetchAll() as $o) {
                        $moved[] = ['handle' => $o['github_identifier'], 'fromStudentId' => (int) $o['student_id']];
                        $previousOwners[(int) $o['student_id']] = true;
                    }

                    $link = $pdo->prepare(
                        'INSERT INTO student_github_accounts (student_id, github_identifier) VALUES (:s, :g)
                         ON DUPLICATE KEY UPDATE student_id = VALUES(student_id)'
                    );
                    foreach ($toLink as $handle) {
                        $link->execute(['s' => $studentId, 'g' => $handle]);
                    }
                }

                // Studenten die hun laatste handle kwijt zijn: lege schillen opruimen, de rest bewaren
                foreach (array_keys($previousOwners) as $ownerId) {
                    if ($ownerId === $studentId) {
                        continue;
                    }
                    $left = $pdo->prepare('SELECT COUNT(*) FROM student_github_accounts WHERE student_id = :s');
                    $left->execute(['s' => $ownerId]);
                    if ((int) $left->fetchColumn() > 0) {
                        continue;
                    }
                    // Logboekregels verhuizen mee (anders wist de FK-cascade ze bij het opruimen van de schil)
                    $pdo->prepare('UPDATE coaching_logs SET student_id = :new WHERE student_id = :old')
                        ->execute(['new' => $studentId, 'old' => $ownerId]);
                    $info = $pdo->prepare('SELECT notes, student_number FROM students WHERE id = :s');
                    $info->execute(['s' => $ownerId]);
                    $row = $info->fetch();
                    if ($row !== false && trim((string) $row['notes']) === '' && $row['student_number'] === null) {
                        $pdo->prepare('DELETE FROM students WHERE id = :s')->execute(['s' => $ownerId]);
                        $deleted[] = $ownerId;
                    } else {
                        $kept[] = $ownerId;      // notities en studentnummers gaan nooit verloren
                    }
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        return [
            'created' => $created,
            'student' => $this->find($studentId),
            'movedHandles' => $moved,
            'removedHandles' => $removed,
            'deletedStudentIds' => $deleted,
            'keptOrphanStudentIds' => $kept,
        ];
    }

    /** @return list<string> */
    private function handlesOf(int $id): array
    {
        $stmt = ($this->db)()->prepare('SELECT github_identifier FROM student_github_accounts WHERE student_id = :s ORDER BY github_identifier');
        $stmt->execute(['s' => $id]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }
}
