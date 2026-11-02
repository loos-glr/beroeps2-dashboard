<?php

declare(strict_types=1);

// Pure deel altijd, DB-deel alleen met een database waarvan de naam op _test eindigt:
//   DB_HOST=127.0.0.1 DB_PORT=3307 DB_NAME=glr_beroeps2_test DB_USER=… DB_PASS=… php tests/coaching_log_test.php

use App\Http\HttpException;
use App\Services\CoachingLogService as C;
use App\Services\Dates;
use App\Services\StudentIdentityService;

spl_autoload_register(static function (string $class): void {
    $file = dirname(__DIR__) . '/src/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (str_starts_with($class, 'App\\') && is_file($file)) {
        require $file;
    }
});

$failures = 0;
function check(string $name, mixed $actual, mixed $expected): void
{
    global $failures;
    if ($actual === $expected) {
        echo "  ok   {$name}\n";
        return;
    }
    $failures++;
    echo "  FAIL {$name}\n    verwacht: " . json_encode($expected) . "\n    kreeg:    " . json_encode($actual) . "\n";
}

/* ===== Puur: summarize() en tijdzones ===== */

$row = static fn (?int $team, ?int $student, ?string $due, int $resolved, string $at): array =>
    ['team_id' => $team, 'student_id' => $student, 'follow_up_date' => $due, 'is_resolved' => $resolved, 'visited_at' => $at];

echo "summarize · visitedToday (Europe/Amsterdam)\n";
$now = new DateTimeImmutable('2026-11-10T23:30:00Z');            // 11 nov 00:30 lokaal (CET)
check('23:30Z van gisteren-UTC telt als vandaag lokaal', C::summarize([$row(1, null, null, 0, '2026-11-10 23:10:00')], $now)['teams'][1]['visitedToday'], true);
check('22:59Z is nog gisteren lokaal', C::summarize([$row(1, null, null, 0, '2026-11-10 22:59:00')], $now)['teams'][1]['visitedToday'], false);
$summer = new DateTimeImmutable('2026-07-10T12:00:00Z');         // CEST, lokale middernacht = 22:00Z
check('zomertijd: 21:59Z is gisteren', C::summarize([$row(1, null, null, 0, '2026-07-09 21:59:00')], $summer)['teams'][1]['visitedToday'], false);
check('zomertijd: 22:00Z is vandaag', C::summarize([$row(1, null, null, 0, '2026-07-09 22:00:00')], $summer)['teams'][1]['visitedToday'], true);

echo "summarize · open en due\n";
check('Dates::localToday rond middernacht', Dates::localToday($now), '2026-11-11');
$s = C::summarize([
    $row(1, 7, '2026-11-11', 0, '2026-11-01 10:00:00'),   // vandaag lokaal: due
    $row(1, 7, '2026-11-12', 0, '2026-11-01 10:00:00'),   // morgen: open, niet due
    $row(1, 7, '2026-11-09', 0, '2026-11-01 10:00:00'),   // verlopen: due
    $row(1, 7, '2026-11-09', 1, '2026-11-01 10:00:00'),   // afgerond: telt niet
    $row(1, 7, null, 0, '2026-11-01 10:00:00'),           // snelle vink zonder datum: geen afspraak
], $now);
check('student: open/due/log', [$s['students'][7]['openFollowUps'], $s['students'][7]['dueFollowUps'], $s['students'][7]['logCount']], [3, 2, 5]);
check('team telt ook studentlogs', $s['teams'][1]['logCount'], 5);
check('log zonder team/student bestaat niet', C::summarize([$row(null, null, null, 0, '2026-11-11 10:00:00')], $now), ['teams' => [], 'students' => []]);
check('emptySummary', C::emptySummary(), ['visitedToday' => false, 'openFollowUps' => 0, 'dueFollowUps' => 0, 'logCount' => 0]);

/* ===== DB ===== */

$name = getenv('DB_NAME') ?: '';
if (!str_ends_with($name, '_test')) {
    echo "\nDB-tests overgeslagen (DB_NAME moet op _test eindigen)\n";
    echo $failures === 0 ? "\nAlles OK\n" : "\n{$failures} test(s) mislukt\n";
    exit($failures === 0 ? 0 : 1);
}

$pdo = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', getenv('DB_HOST') ?: '127.0.0.1', (int) (getenv('DB_PORT') ?: 3306), $name),
    getenv('DB_USER') ?: '', getenv('DB_PASS') ?: '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false,
    ]);
$pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'");
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) {
    $pdo->exec("DROP TABLE `{$t}`");
}
$pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
// Het schema bevat geen ; binnen strings, dus splitsen op ; aan het eind van de regel is veilig
$sql = preg_replace('/^--.*$/m', '', (string) file_get_contents(dirname(__DIR__) . '/sql/schema.sql'));
foreach (array_filter(array_map('trim', explode(";\n", (string) $sql))) as $stmt) {
    $pdo->exec($stmt);
}

$db = static fn () => $pdo;
$logs = new C($db);
$students = new StudentIdentityService($db);
$pdo->exec("INSERT INTO academic_contexts (id, school_year, course_code, class_name) VALUES (1, '2026-2027', 'BEROEPS2', 'D2B'), (2, '2026-2027', 'BEROEPS2', 'D2C')");
$pdo->exec("INSERT INTO teams (id, context_id, team_name, repo_full_name) VALUES (1, 1, 'Team A', 'o/a'), (2, 2, 'Team B', 'o/b')");
$now = new DateTimeImmutable('2026-11-10T23:30:00Z');     // 11 nov 00:30 lokaal

echo "create · defaults en validatie\n";
$r = $logs->create(1, ['teamId' => 1], $now);
check('lege notitie krijgt standaardtekst', $r['log']['noteText'], 'Besproken tijdens lesronde');
check('visitedToday na team-vink', $r['summaries']['teams'][1]['visitedToday'], true);
check('geen student bij team-log', [$r['student'], $r['log']['studentId']], [null, null]);
foreach ([['team uit andere klas', ['teamId' => 2], 422], ['niets opgegeven', [], 422], ['onbekende student', ['studentId' => 999], 404]] as [$label, $input, $status]) {
    try {
        $logs->create(1, $input, $now);
        check($label, 'geen fout', "HTTP {$status}");
    } catch (HttpException $e) {
        check($label, $e->status, $status);
    }
}

echo "create · student automatisch aanmaken uit githubIdentifier\n";
$r = $logs->create(1, ['teamId' => 1, 'githubIdentifier' => 'Nieuw-Lid', 'fullName' => 'Nina Nieuw', 'noteText' => 'Plan besproken', 'followUpDate' => '2026-11-11'], $now);
$sid = $r['log']['studentId'];
check('student aangemaakt en teruggegeven', [$r['student']['fullName'], $r['student']['handles']], ['Nina Nieuw', ['nieuw-lid']]);
check('log gekoppeld aan student', $r['log']['studentName'], 'Nina Nieuw');
check('student-summary: due (vandaag lokaal)', [$r['summaries']['students'][$sid]['openFollowUps'], $r['summaries']['students'][$sid]['dueFollowUps']], [1, 1]);
$r2 = $logs->create(1, ['teamId' => 1, 'githubIdentifier' => 'NIEUW-LID'], $now);
check('tweede log hergebruikt de student', [$r2['log']['studentId'], $r2['student']['id']], [$sid, $sid]);
check('geen dubbele studenten', (int) $pdo->query('SELECT COUNT(*) FROM students')->fetchColumn(), 1);

echo "create · resolveDue\n";
$logs->create(1, ['studentId' => $sid, 'followUpDate' => '2026-11-20', 'noteText' => 'later'], $now);
$r3 = $logs->create(1, ['teamId' => 1, 'studentId' => $sid, 'resolveDue' => true], $now);
check('alleen verlopen afspraken afgerond', count($r3['resolvedIds']), 1);
check('toekomstige afspraak blijft open', [$r3['summaries']['students'][$sid]['openFollowUps'], $r3['summaries']['students'][$sid]['dueFollowUps']], [1, 0]);

echo "update en delete\n";
$open = $logs->create(1, ['studentId' => $sid, 'followUpDate' => '2026-11-01', 'noteText' => 'oud'], $now);
check('verlopen afspraak is due', $open['summaries']['students'][$sid]['dueFollowUps'], 1);
$u = $logs->update($open['log']['id'], ['isResolved' => true]);
check('afronden: isResolved', $u['log']['isResolved'], true);
check('afronden: due weer 0', $u['summaries']['students'][$sid]['dueFollowUps'], 0);
$u = $logs->update($open['log']['id'], ['followUpDate' => null, 'noteText' => 'aangepast']);
check('datum wissen + tekst wijzigen', [$u['log']['followUpDate'], $u['log']['noteText']], [null, 'aangepast']);
$d = $logs->delete($open['log']['id']);
check('delete: log weg', count(array_filter($logs->list(1), static fn ($l) => $l['id'] === $open['log']['id'])), 0);
try {
    $logs->update(99999, ['isResolved' => true]);
    check('onbekende log', 'geen fout', 'HTTP 404');
} catch (HttpException $e) {
    check('onbekende log', $e->status, 404);
}
check('list per klas', count($logs->list(2)), 0);

echo "samenvoegen verhuist logboek\n";
$a = $students->upsert(null, ['fullName' => 'Oud'], ['oud-account'])['student']['id'];
$logs->create(1, ['studentId' => $a, 'noteText' => 'moet mee'], $now);
$b = $students->upsert(null, ['fullName' => 'Doel'], [])['student']['id'];
$students->upsert($b, [], ['oud-account']);         // handle verhuist; lege schil van $a wordt opgeruimd
check('oude student opgeruimd', (int) $pdo->query("SELECT COUNT(*) FROM students WHERE id = {$a}")->fetchColumn(), 0);
check('log verhuisd naar doel-student', (int) $pdo->query("SELECT COUNT(*) FROM coaching_logs WHERE student_id = {$b} AND note_text = 'moet mee'")->fetchColumn(), 1);

echo $failures === 0 ? "\nAlles OK\n" : "\n{$failures} test(s) mislukt\n";
exit($failures === 0 ? 0 : 1);
