<?php

declare(strict_types=1);

// Pure test (geen DB/netwerk):  php tests/import_test.php

use App\Http\HttpException;
use App\Services\MigrationService as M;
use App\Services\TeamAnalyticsService as T;

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
function rejects(string $name, mixed $data, int $status): void
{
    try {
        M::parse($data);
        check($name, 'geen fout', "HTTP {$status}");
    } catch (HttpException $e) {
        check($name, $e->status, $status);
    }
}
$codes = static fn (array $plan) => array_column($plan['warnings'], 'code');
$decode = static fn (string $json) => json_decode($json, true);

echo "formaten\n";
$v1 = M::parse($decode('[{"name":"Team 1","repo":"https://github.com/Owner/Repo.git/","expectedMembers":["@A","a","B"]}]'));
check('v1: formaat', $v1['format'], 'v1');
check('v1: repo genormaliseerd', $v1['teams'][0]['repo'], 'Owner/Repo');
check('v1: expected genormaliseerd + ontdubbeld', $v1['teams'][0]['expected'], ['a', 'b']);
check('v1: geen groepen', $v1['groups'], []);

// Letterlijk wat exportConfigJson() schrijft (geen expectedMembers)
$poc = M::parse($decode('{"version":2,"teams":[{"name":"Team 1","repo":"o/r"},{"name":"","repo":"o/r2"}],
  "aliases":{"sem-glr":"Sem de Vries","semdevries99":" sem de vries ","els":"Els"}}'));
check('v2: formaat', $poc['format'], 'v2');
check('v2: lege naam → repo', $poc['teams'][1]['name'], 'o/r2');
check('v2: groepen op naam', $poc['groups'], [
    ['fullName' => 'Els', 'handles' => ['els']],
    ['fullName' => 'Sem de Vries', 'handles' => ['sem-glr', 'semdevries99']],
]);
check('v2: geen warnings', $poc['warnings'], []);
check('alleen aliases', count(M::parse($decode('{"aliases":{"a":"A"}}'))['teams']), 0);
check('alleen teams, aliases {}', M::parse($decode('{"teams":[{"repo":"o/r"}],"aliases":{}}'))['groups'], []);
check('tolerante sleutels', M::parse($decode('{"teams":[{"teamName":"X","repoFullName":"o/r"}]}'))['teams'][0]['name'], 'X');

echo "afwijzen\n";
rejects('leeg', [], 422);
rejects('string', 'x', 422);
rejects('object zonder teams/aliases', ['foo' => 1], 422);
rejects('versie 3', ['version' => 3, 'teams' => []], 422);
rejects('teams geen lijst', ['teams' => ['a' => 1]], 422);
rejects('aliases is lijst', ['aliases' => ['x']], 422);
rejects('te veel teams', array_fill(0, M::MAX_TEAMS + 1, ['repo' => 'o/r']), 422);
rejects('te veel aliassen', ['aliases' => array_combine(array_map(fn ($i) => "h{$i}", range(1, M::MAX_ALIASES + 1)), array_fill(0, M::MAX_ALIASES + 1, 'N'))], 422);
rejects('te veel expectedMembers', [['repo' => 'o/r', 'expectedMembers' => array_map(fn ($i) => "h{$i}", range(1, 101))]], 422);

echo "itemwarnings\n";
$p = M::parse($decode('[5,{"name":"x"},{"repo":"geen-repo"},{"repo":"o/ok","name":"A"},{"repo":"O/OK","name":"B","expectedMembers":["x"]},{"repo":"o/ok","expectedMembers":"x"}]'));
check('warning-codes', $codes($p), ['invalid_team', 'invalid_repo', 'invalid_repo', 'duplicate_repo', 'invalid_team', 'duplicate_repo']);
check('dubbele repo: één team, laatste naam, verenigde leden', [count($p['teams']), $p['teams'][0]['name'], $p['teams'][0]['expected']], [1, 'B', ['x']]);

$a = M::parse($decode('{"aliases":{"@Sem":"Oud","sem":"Nieuw","":"X","kaal":"","num":5,"123":"Num"}}'));
check('alias: laatste wint, rest warnings', $codes($a), ['duplicate_handle', 'invalid_alias', 'invalid_alias', 'invalid_alias']);
check('alias: groepen', $a['groups'], [
    ['fullName' => 'Nieuw', 'handles' => ['sem']],
    ['fullName' => 'Num', 'handles' => ['123']],
]);
$long = M::parse(['aliases' => ['a' => str_repeat('x', 256)], 'teams' => [['repo' => 'o/r', 'name' => str_repeat('y', 256)]]]);
check('te lange naam: overgeslagen', [$codes($long), $long['teams'], $long['groups']], [['too_long', 'too_long'], [], []]);

echo "groepsgrootte\n";
$aliases = ['ok1' => 'Echt', 'ok2' => 'Echt'];
foreach (range(1, 21) as $i) {
    $aliases["anon{$i}"] = 'Onbekend';
}
$g = M::parse(['teams' => [['repo' => 'o/r']], 'aliases' => $aliases]);
check('21 handles: groep overgeslagen', array_column($g['groups'], 'fullName'), ['Echt']);
check('21 handles: warning met aantal', [$codes($g), $g['warnings'][0]['item']['handleCount']], [['too_many_handles_in_group'], 21]);
check('21 handles: teams blijven', count($g['teams']), 1);
$g20 = M::parse(['aliases' => array_combine(array_map(fn ($i) => "h{$i}", range(1, 20)), array_fill(0, 20, 'Vol'))]);
check('20 handles: toegestaan', [count($g20['groups']), $g20['warnings']], [1, []]);

echo "keten: parse → dashboard\n";
$sem = $poc['groups'][1];
$ident = ['studentId' => 1, 'fullName' => $sem['fullName'], 'studentNumber' => null, 'notes' => null, 'linkedHandles' => $sem['handles']];
$identityMap = array_fill_keys($sem['handles'], $ident);       // wat loadIdentityMap na de import oplevert
$snap = [
    'accounts' => [
        'sem-glr' => ['login' => 'sem-glr', 'avatar' => null, 'isGitName' => false, 'lastActive' => null, 'commits' => [], 'prs' => [], 'createdIssues' => [], 'assignedIssues' => []],
    ],
    'collaborators' => [], 'issues' => [],
];
$members = T::enrichAndMergeStudents($snap, $identityMap, $poc['teams'][0]['expected'] + ['semdevries99'], 'teacher', 7, new DateTimeImmutable('2026-11-10T12:00:00Z'));
$merged = array_values(array_filter($members, static fn ($m) => $m['displayName'] === 'Sem de Vries'));
check('één student voor beide accounts', count($merged), 1);
check('isMerged (via expected)', [$merged[0]['isMerged'], $merged[0]['handles']], [true, ['sem-glr', 'semdevries99']]);

echo $failures === 0 ? "\nAlles OK\n" : "\n{$failures} test(s) mislukt\n";
exit($failures === 0 ? 0 : 1);
