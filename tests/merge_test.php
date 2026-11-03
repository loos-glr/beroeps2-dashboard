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

// Rijen zoals ze uit de repo_*-tabellen komen (tijden: 'Y-m-d H:i:s' UTC)
$agg = static fn (string $who, int $total, int $inPeriod, string $last, ?string $avatar = null) => [
    'author_identifier' => $who, 'total' => $total, 'in_period' => $inPeriod, 'last_at' => $last, 'avatar' => $avatar ?? "https://a/{$who}",
];
$commit = static fn (string $sha, string $who, string $at) => [
    'author_identifier' => $who, 'sha' => $sha, 'message_headline' => "feat: {$sha}", 'message_body' => 'body',
    'committed_at' => $at, 'commit_url' => "https://c/{$sha}",
];
$pr = static fn (int $n, string $who, string $state, string $created, ?string $merged = null) => [
    'pr_number' => $n, 'author_identifier' => $who, 'author_avatar' => null, 'title' => "pr{$n}", 'state' => $state,
    'created_at' => $created, 'updated_at' => $created, 'merged_at' => $merged, 'head_ref' => 'feature/x', 'base_ref' => 'main', 'pr_url' => "https://p/{$n}",
];
$issue = static fn (int $n, string $state, string $who, array $assignees, string $created = '2026-11-01 10:00:00') => [
    'issue_number' => $n, 'author_identifier' => $who, 'author_avatar' => null, 'title' => "i{$n}", 'state' => $state,
    'created_at' => $created, 'updated_at' => "2026-11-0{$n} 10:00:00", 'closed_at' => null, 'issue_url' => "https://i/{$n}",
    'assignees_json' => json_encode($assignees), 'labels_json' => json_encode([['name' => 'bug', 'color' => 'd73a4a'], ['name' => 'feature', 'color' => '000000']]),
];

$aggRows = [
    $agg('alice', 5, 2, '2026-11-09 10:00:00'),
    $agg('alice-glr', 1, 1, '2026-11-08 10:00:00'),
    $agg('teacher', 3, 3, '2026-11-09 11:00:00'),
    $agg('dependabot[bot]', 4, 4, '2026-11-09 11:00:00'),
    $agg('git naam', 1, 0, '2026-11-02 10:00:00'),
];
$recent = [
    $commit('aaa1111', 'alice', '2026-11-09 10:00:00'),
    $commit('aaa2222', 'alice', '2026-11-05 10:00:00'),
    $commit('bbb2222', 'alice-glr', '2026-11-08 10:00:00'),
    $commit('ccc3333', 'teacher', '2026-11-09 11:00:00'),
    $commit('eee5555', 'git naam', '2026-11-02 10:00:00'),
];
$prs = [$pr(4, 'alice', 'MERGED', '2026-11-03 10:00:00', '2026-11-04 09:00:00'), $pr(5, 'alice-glr', 'OPEN', '2026-11-08 10:00:00')];
$issues = [
    $issue(1, 'OPEN', 'alice', ['alice', 'alice-glr']),                 // aan beide accounts toegewezen
    ['closed_at' => '2026-11-03 10:00:00'] + $issue(2, 'CLOSED', 'bob', ['alice'], '2026-11-02 10:00:00'),
];
// Zonder periode-filter geeft SQL in_period = total; "vandaag" zonder commits geeft in_period = 0
$aggAll = array_map(static fn (array $r) => ['in_period' => $r['total']] + $r, $aggRows);
$aggNone = array_map(static fn (array $r) => ['in_period' => 0] + $r, $aggRows);
$collabs = [['login' => 'alice', 'avatar_url' => null], ['login' => 'bob', 'avatar_url' => null], ['login' => 'teacher', 'avatar_url' => null]];

echo "buildAccounts\n";
$snap = T::buildAccounts($aggAll, $recent, $prs, $issues, $collabs, 'teacher');
check('docent en bots gefilterd', array_keys($snap['accounts']), ['alice', 'bob', 'alice-glr', 'git naam']);
check('team-totalen (alleen studenten)', $snap['totals'], ['commits' => 7, 'prs' => 2, 'prsMerged' => 1, 'issues' => 2, 'openIssues' => 1, 'issuesClosed' => 1, 'issuesClosedInPeriod' => 1]);
check('labels als namen', $snap['issues'][1]['labels'], ['bug', 'feature']);
check('state lowercase + merged', $snap['accounts']['alice']['prs'][0]['state'], 'merged');
check('git-naam herkend', [$snap['accounts']['git naam']['isGitName'], $snap['accounts']['alice']['isGitName']], [true, false]);
check('commit title/body', [$snap['accounts']['alice']['latestCommit']['title'], $snap['accounts']['alice']['latestCommit']['body']], ['feat: aaa1111', 'body']);
check('datum als ISO met Z', $snap['accounts']['alice']['latestCommit']['date'], '2026-11-09T10:00:00Z');
check('lastActive = max over commits/PR/issue', $snap['accounts']['alice']['lastActive'], '2026-11-09T10:00:00Z');
check('collaborator zonder bijdrage is zichtbaar', [$snap['accounts']['bob']['commitCountAll'], $snap['collaborators']], [0, ['alice', 'bob']]);

$from = new DateTimeImmutable('2026-11-08T00:00:00Z');
$f = T::buildAccounts($aggRows, $recent, $prs, $issues, $collabs, 'teacher', $from);
check('periode: commits volgen filter', [$f['accounts']['alice']['commitCount'], $f['accounts']['alice']['commitCountAll']], [2, 5]);
check('periode: recente commits gefilterd, laatste niet', [count($f['accounts']['alice']['commits']), $f['accounts']['alice']['latestCommit']['sha']], [1, 'aaa1111']);
check('periode: PR\'s gefilterd op created_at', [count($f['accounts']['alice']['prs']), $f['accounts']['alice']['prCountAll']], [0, 1]);
check('periode: aangemaakte issues gefilterd', [$f['accounts']['bob']['createdIssues'], $f['accounts']['bob']['createdIssuesAll']], [[], 1]);
check('periode: assigned altijd actueel', $f['accounts']['alice']['assignedIssues'], [1, 2]);
check('periode: teamtotalen', $f['totals'], ['commits' => 3, 'prs' => 1, 'prsMerged' => 0, 'issues' => 0, 'openIssues' => 1, 'issuesClosed' => 1, 'issuesClosedInPeriod' => 0]);
$wide = T::buildAccounts($aggRows, $recent, $prs, $issues, $collabs, 'teacher', new DateTimeImmutable('2026-11-01T00:00:00Z'));
check('periode: gesloten issues binnen bereik', [$wide['totals']['issuesClosed'], $wide['totals']['issuesClosedInPeriod'], $wide['totals']['prsMerged']], [1, 1, 1]);

echo "enrichAndMergeStudents\n";
$byName = static fn (array $members, string $name) => array_values(array_filter($members, static fn ($m) => $m['displayName'] === $name))[0] ?? null;

$plain = T::enrichAndMergeStudents($snap, [], ['ghost'], 'teacher', 7, $now);
check('zonder koppeling: alle accounts apart', count($plain), 5);        // alice, bob, alice-glr, git naam, ghost
check('verwacht lid zonder activiteit is rood', $byName($plain, 'ghost')['status']['reason'], 'no_code');
check('verwacht lid is isExpectedOnly', $byName($plain, 'ghost')['isExpectedOnly'], true);
check('sortering: minste commits eerst', $plain[0]['totals']['commits'], 0);

$ident = ['studentId' => 12, 'fullName' => 'Alice de Vries', 'studentNumber' => '123', 'notes' => 'n', 'linkedHandles' => ['alice', 'alice-glr']];
$map = ['alice' => $ident, 'alice-glr' => $ident];
$merged = T::enrichAndMergeStudents($snap, $map, [], 'teacher', 7, $now);
$a = $byName($merged, 'Alice de Vries');
check('samengevoegd: één lid', count(array_filter($merged, static fn ($m) => $m['key'] === 's:12')), 1);
check('isMerged', $a['isMerged'], true);
check('handles', $a['handles'], ['alice', 'alice-glr']);
check('commits som', $a['totals']['commits'], 6);
check('recente commits samengevoegd, nieuwste eerst', array_column($a['commits'], 'sha'), ['aaa1111', 'bbb2222', 'aaa2222']);
check('PRs som', [$a['totals']['prsCreated'], $a['totals']['prsMerged'], $a['totals']['prsOpen']], [2, 1, 1]);
check('gedeeld issue telt 1x als assigned', $a['totals']['issuesAssigned'], 2);      // #1 (beide accounts) + #2
check('assigned open/closed', [$a['totals']['issuesAssignedOpen'], $a['totals']['issuesAssignedClosed']], [1, 1]);
check('issues created', $a['totals']['issuesCreated'], 1);
check('lastActive = max', $a['lastActive'], '2026-11-09T10:00:00Z');
check('daysInactive', $a['daysInactive'], 1);
check('latestCommit', $a['latestCommit']['sha'], 'aaa1111');
check('status green', $a['status']['level'], 'green');
check('naam uit DB, linkedHandles', [$a['student']['id'], $a['linkedHandles']], [12, ['alice', 'alice-glr']]);

// Periode-filter verandert de aantallen, maar niet de status
$fm = $byName(T::enrichAndMergeStudents($f, $map, [], 'teacher', 7, $now), 'Alice de Vries');
check('filter: periode-commits', $fm['totals']['commits'], 3);
check('filter: all-time totalen blijven', $fm['totalsAll'], ['commits' => 6, 'prsCreated' => 2, 'issuesCreated' => 1]);
check('filter: status blijft op alle activiteit', $fm['status']['level'], 'green');
check('filter: assigned onveranderd', $fm['totals']['issuesAssigned'], 2);
$none = T::buildAccounts($aggNone, $recent, $prs, $issues, $collabs, 'teacher', new DateTimeImmutable('2026-11-10T00:00:00Z'));
$nm = $byName(T::enrichAndMergeStudents($none, $map, [], 'teacher', 7, $now), 'Alice de Vries');
check('vandaag zonder commits is niet rood', [$nm['totals']['commits'], $nm['status']['level']], [0, 'green']);

// Numerieke GitHub-logins worden integer-arraysleutels; dat mag niets breken
$numeric = T::buildAccounts([$agg('192524447', 2, 2, '2026-11-09 10:00:00')], [], [], [], [], 'teacher');
$nm2 = T::enrichAndMergeStudents($numeric, [], [], 'teacher', 7, $now);
check('numerieke login', [$nm2[0]['username'], $nm2[0]['totals']['commits']], ['192524447', 2]);

// Live docentfilter, ook als die in de data zit
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
