<?php

declare(strict_types=1);

// Pure test (geen DB/netwerk):  php tests/merge_test.php

use App\Http\HttpException;
use App\Services\GitHubIdentifier;
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

$now = new DateTimeImmutable('2026-11-10T12:00:00Z');
$user = static fn (string $login, string $type = 'User') => ['login' => $login, 'avatar_url' => "https://a/{$login}", 'type' => $type];
$commit = static fn (string $sha, ?array $author, string $date, string $msg = "feat: x\n\nbody") => [
    'sha' => $sha, 'html_url' => "https://c/{$sha}", 'author' => $author,
    'commit' => ['message' => $msg, 'author' => ['name' => 'Git Naam', 'date' => $date]],
];
$issue = static fn (int $n, string $state, ?array $creator, array $assignees = [], bool $isPr = false) => [
    'number' => $n, 'title' => "i{$n}", 'state' => $state, 'created_at' => '2026-11-01T10:00:00Z',
    'updated_at' => "2026-11-0{$n}T10:00:00Z", 'closed_at' => null, 'html_url' => "https://i/{$n}",
    'labels' => [['name' => 'bug'], 'feature'], 'user' => $creator, 'assignees' => $assignees,
] + ($isPr ? ['pull_request' => ['url' => 'x']] : []);
$pr = static fn (int $n, array $u, string $state, ?string $merged) => [
    'number' => $n, 'title' => "pr{$n}", 'state' => $state, 'merged_at' => $merged, 'user' => $u,
    'created_at' => '2026-11-03T10:00:00Z', 'updated_at' => '2026-11-04T10:00:00Z', 'html_url' => "https://p/{$n}",
    'head' => ['ref' => 'feature/x'], 'base' => ['ref' => 'main'],
];

echo "buildSnapshot\n";
$raw = [
    'commits' => [
        $commit('aaa1111', $user('Alice'), '2026-11-09T10:00:00Z'),
        $commit('bbb2222', $user('alice-glr'), '2026-11-08T10:00:00Z'),
        $commit('ccc3333', $user('Teacher'), '2026-11-09T11:00:00Z'),
        $commit('ddd4444', $user('dependabot[bot]', 'Bot'), '2026-11-09T11:00:00Z'),
        $commit('eee5555', null, '2026-11-02T10:00:00Z'),
    ],
    'pulls' => [$pr(4, $user('alice'), 'closed', '2026-11-04T09:00:00Z'), $pr(5, $user('alice-glr'), 'open', null)],
    'issues' => [
        $issue(1, 'open', $user('alice'), [$user('alice'), $user('alice-glr')]),   // aan beide accounts toegewezen
        $issue(2, 'closed', $user('bob'), [$user('alice')]),
        $issue(6, 'open', $user('alice'), [], true),                                // PR in /issues
    ],
    'branches' => [['name' => 'main'], ['name' => 'dev']],
    'collaborators' => [$user('Alice'), $user('bob'), $user('Teacher')],
];
$snap = T::buildSnapshot('glr/team', $raw, 'teacher', true, '2026-11-10T11:00:00Z');
check('docent en bots gefilterd', array_keys($snap['accounts']), ['alice', 'bob', 'alice-glr', 'git naam']);
check('PR in /issues telt niet als issue', array_keys($snap['issues']), [1, 2]);
check('totals', $snap['totals'], ['commits' => 5, 'prs' => 2, 'issues' => 2, 'openIssues' => 1, 'branches' => 2]);
check('labels als strings', $snap['issues'][1]['labels'], ['bug', 'feature']);
check('merged PR state', $snap['accounts']['alice']['prs'][0]['state'], 'merged');
check('git-naam fallback', $snap['accounts']['git naam']['isGitName'], true);
check('commit title/body', [$snap['accounts']['alice']['commits'][0]['title'], $snap['accounts']['alice']['commits'][0]['body']], ['feat: x', 'body']);
check('collaboratorsDetected', $snap['collaboratorsDetected'], true);
check('geen collaborators → niet gedetecteerd', T::buildSnapshot('r/r', ['commits' => [], 'pulls' => [], 'issues' => [], 'branches' => [], 'collaborators' => null], '', false, 'x')['collaboratorsDetected'], false);

echo "enrichAndMergeStudents\n";
$snap = json_decode(json_encode($snap), true);            // zoals uit team_snapshots gelezen
$identity = [];
$byName = static fn (array $members, string $name) => array_values(array_filter($members, static fn ($m) => $m['displayName'] === $name))[0] ?? null;

$plain = T::enrichAndMergeStudents($snap, $identity, ['ghost'], 'teacher', 7, $now);
check('zonder koppeling: alle accounts apart', count($plain), 5);        // alice, bob, alice-glr, git naam, ghost
check('verwacht lid zonder activiteit is rood', $byName($plain, 'ghost')['status']['reason'], 'no_code');
check('verwacht lid is isExpectedOnly', $byName($plain, 'ghost')['isExpectedOnly'], true);
check('sortering: minste commits eerst', $plain[0]['totals']['commits'], 0);

$ident = ['studentId' => 12, 'fullName' => 'Alice de Vries', 'studentNumber' => '123', 'notes' => 'n', 'linkedHandles' => ['alice', 'alice-glr']];
$merged = T::enrichAndMergeStudents($snap, ['alice' => $ident, 'alice-glr' => $ident], [], 'teacher', 7, $now);
$a = $byName($merged, 'Alice de Vries');
check('samengevoegd: één lid', count(array_filter($merged, static fn ($m) => $m['key'] === 's:12')), 1);
check('isMerged', $a['isMerged'], true);
check('handles', $a['handles'], ['Alice', 'alice-glr']);
check('commits som', $a['totals']['commits'], 2);
check('PRs som', [$a['totals']['prsCreated'], $a['totals']['prsMerged'], $a['totals']['prsOpen']], [2, 1, 1]);
check('gedeeld issue telt 1x als assigned', $a['totals']['issuesAssigned'], 2);      // #1 (beide accounts) + #2
check('assigned open/closed', [$a['totals']['issuesAssignedOpen'], $a['totals']['issuesAssignedClosed']], [1, 1]);
check('issues created ontdubbeld', $a['totals']['issuesCreated'], 1);
check('lastActive = max', $a['lastActive'], '2026-11-09T10:00:00Z');
check('daysInactive', $a['daysInactive'], 1);
check('latestCommit', $a['latestCommit']['sha'], 'aaa1111');
check('status green', $a['status']['level'], 'green');
check('naam uit DB, linkedHandles', [$a['student']['id'], $a['linkedHandles']], [12, ['alice', 'alice-glr']]);

// Dezelfde commit bij beide accounts → 1x
$dup = $snap;
$dup['accounts']['alice-glr']['commits'][] = $dup['accounts']['alice']['commits'][0];
$m2 = $byName(T::enrichAndMergeStudents($dup, ['alice' => $ident, 'alice-glr' => $ident], [], 'teacher', 7, $now), 'Alice de Vries');
check('dubbele sha telt 1x', $m2['totals']['commits'], 2);

// Docent live gefilterd, ook als die in de snapshot zit
$live = T::enrichAndMergeStudents($snap, [], [], 'bob', 7, $now);
check('live docentfilter', $byName($live, 'bob'), null);

echo "evaluateStatus\n";
$t = static fn (int $c, int $p) => ['commits' => $c, 'prsCreated' => $p];
check('0 bijdragen', T::evaluateStatus($t(0, 0), null, 7)['level'], 'red');
check('precies drempel = ok', T::evaluateStatus($t(3, 1), 7, 7)['level'], 'green');
check('drempel + 1 = rood', T::evaluateStatus($t(3, 1), 8, 7), ['level' => 'red', 'reason' => 'inactive', 'label' => '8 dagen stil']);
check('>2 commits zonder PR = amber', T::evaluateStatus($t(3, 0), 0, 7)['level'], 'amber');
check('2 commits zonder PR = green', T::evaluateStatus($t(2, 0), 0, 7)['level'], 'green');
check('alleen PR telt als bijdrage', T::evaluateStatus($t(0, 1), 0, 7)['level'], 'green');

echo "GitHubIdentifier\n";
check('normalize', GitHubIdentifier::normalize('  @Alice-GLR '), 'alice-glr');
check('normalizeList', GitHubIdentifier::normalizeList(['@A', 'a', ' ', 5, 'B']), ['a', 'b']);
check('repo url', GitHubIdentifier::normalizeRepo('https://github.com/glr-d2b/Team-1.git/'), 'glr-d2b/Team-1');
check('repo ongeldig', GitHubIdentifier::normalizeRepo('foo'), null);
check('repo path traversal', GitHubIdentifier::normalizeRepo('a/..'), null);

echo $failures === 0 ? "\nAlles OK\n" : "\n{$failures} test(s) mislukt\n";
exit($failures === 0 ? 0 : 1);
