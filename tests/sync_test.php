<?php

declare(strict_types=1);

// Pure test (geen DB/netwerk):  php tests/sync_test.php

use App\Services\Dates;
use App\Services\GitHubGraphQLService as G;

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

echo "parseRepository\n";
$repo = [
    'pushedAt' => '2026-11-09T10:00:00Z',
    'refs' => ['totalCount' => 3],
    'defaultBranchRef' => ['target' => ['history' => [
        'pageInfo' => ['hasNextPage' => true, 'endCursor' => 'abc'],
        'nodes' => [
            ['oid' => str_repeat('a', 40), 'messageHeadline' => 'feat: één', 'messageBody' => "  uitleg\n", 'committedDate' => '2026-11-09T11:30:00+01:00',
                'url' => 'https://c/1', 'author' => ['name' => 'Alice', 'avatarUrl' => 'https://av/x', 'user' => ['login' => 'Alice-GLR', 'avatarUrl' => 'https://av/alice']]],
            ['oid' => str_repeat('b', 40), 'messageHeadline' => '', 'messageBody' => '', 'committedDate' => '2026-11-08T10:00:00Z',
                'url' => 'https://c/2', 'author' => ['name' => 'Git Naam', 'avatarUrl' => null, 'user' => null]],
        ],
    ]]],
    'pullRequests' => ['pageInfo' => ['hasNextPage' => false, 'endCursor' => null], 'nodes' => [
        ['number' => 7, 'title' => str_repeat('t', 600), 'state' => 'MERGED', 'createdAt' => '2026-11-03T10:00:00Z', 'updatedAt' => '2026-11-04T10:00:00Z',
            'mergedAt' => '2026-11-04T10:00:00Z', 'headRefName' => 'feature/x', 'baseRefName' => 'main', 'url' => 'https://p/7',
            'author' => ['__typename' => 'User', 'login' => 'Alice-GLR', 'avatarUrl' => null]],
        ['number' => 8, 'title' => 'bot pr', 'state' => 'OPEN', 'createdAt' => '2026-11-05T10:00:00Z', 'updatedAt' => '2026-11-05T10:00:00Z',
            'mergedAt' => null, 'headRefName' => 'dep', 'baseRefName' => 'main', 'url' => 'https://p/8',
            'author' => ['__typename' => 'Bot', 'login' => 'dependabot', 'avatarUrl' => null]],
        ['number' => 9, 'title' => 'verwijderde gebruiker', 'state' => 'CLOSED', 'createdAt' => '2026-11-05T10:00:00Z', 'updatedAt' => '2026-11-05T10:00:00Z',
            'mergedAt' => null, 'headRefName' => 'x', 'baseRefName' => 'main', 'url' => 'https://p/9', 'author' => null],
    ]],
    'issues' => ['pageInfo' => ['hasNextPage' => false, 'endCursor' => null], 'nodes' => [
        ['number' => 1, 'title' => 'taak', 'state' => 'OPEN', 'createdAt' => '2026-11-01T10:00:00Z', 'updatedAt' => '2026-11-02T10:00:00Z', 'closedAt' => null, 'url' => 'https://i/1',
            'author' => ['__typename' => 'User', 'login' => 'BOB', 'avatarUrl' => null],
            'assignees' => ['nodes' => [['login' => 'Alice-GLR'], ['login' => 'alice-glr']]],
            'labels' => ['nodes' => [['name' => 'bug', 'color' => 'd73a4a']]]],
    ]],
    'collaborators' => ['nodes' => [['login' => 'Alice-GLR', 'avatarUrl' => 'https://av/alice']]],
];
$p = G::parseRepository($repo);
check('branchCount + pushedAt', [$p['branchCount'], $p['pushedAt']], [3, '2026-11-09 10:00:00']);
check('commit: login lowercase, datum naar UTC', [$p['commits'][0]['author'], $p['commits'][0]['committed_at']], ['alice-glr', '2026-11-09 10:30:00']);
check('commit: avatar van user', $p['commits'][0]['avatar'], 'https://av/alice');
check('commit: body getrimd', $p['commits'][0]['body'], 'uitleg');
check('commit: git-naam fallback', [$p['commits'][1]['author'], $p['commits'][1]['avatar']], ['git naam', null]);
check('commit: lege headline krijgt tekst', $p['commits'][1]['headline'], '(Geen commit message)');
check('history pageInfo', $p['pageInfo']['commits'], ['hasNextPage' => true, 'endCursor' => 'abc']);
check('PR: titel ingekort', mb_strlen($p['prs'][0]['title']), 500);
check('PR: state + mergedAt', [$p['prs'][0]['state'], $p['prs'][0]['merged_at']], ['MERGED', '2026-11-04 10:00:00']);
check('PR: Bot krijgt [bot]-suffix', $p['prs'][1]['author'], 'dependabot[bot]');
check('PR: verwijderde gebruiker', $p['prs'][2]['author'], 'ghost');
check('issue: auteur lowercase', $p['issues'][0]['author'], 'bob');
check('issue: assignees ontdubbeld', $p['issues'][0]['assignees'], ['alice-glr']);
check('issue: labels met kleur', $p['issues'][0]['labels'], [['name' => 'bug', 'color' => 'd73a4a']]);
check('collaborators', $p['collaborators'], [['login' => 'alice-glr', 'avatar' => 'https://av/alice']]);

echo "parseRepository · lege repository\n";
$empty = G::parseRepository([
    'pushedAt' => null, 'refs' => ['totalCount' => 0], 'defaultBranchRef' => null,
    'pullRequests' => ['pageInfo' => ['hasNextPage' => false, 'endCursor' => null], 'nodes' => []],
    'issues' => ['pageInfo' => ['hasNextPage' => false, 'endCursor' => null], 'nodes' => []],
    'collaborators' => ['nodes' => [['login' => 'Nieuw', 'avatarUrl' => null]]],
]);
check('geen commits, geen fout', [$empty['commits'], $empty['pageInfo']['commits']['hasNextPage']], [[], false]);
check('collaborators blijven bewaard', array_column($empty['collaborators'], 'login'), ['nieuw']);
check('pushedAt null', $empty['pushedAt'], null);
$noTarget = G::parseRepository(['defaultBranchRef' => ['target' => null]]);
check('target null / alles ontbreekt', [$noTarget['commits'], $noTarget['prs'], $noTarget['issues'], $noTarget['collaborators'], $noTarget['branchCount']], [[], [], [], [], 0]);

echo "Dates::periodStart\n";
$fmt = static fn (?DateTimeImmutable $d) => $d?->format('Y-m-d\TH:i:s\Z');
$winter = new DateTimeImmutable('2026-11-10T23:30:00Z');       // 11 nov 00:30 in Amsterdam (CET, UTC+1)
check('today (winter): lokale middernacht in UTC', $fmt(Dates::periodStart('today', null, $winter)['from']), '2026-11-10T23:00:00Z');
$summer = new DateTimeImmutable('2026-07-10T12:00:00Z');       // CEST, UTC+2
check('today (zomer)', $fmt(Dates::periodStart('today', null, $summer)['from']), '2026-07-09T22:00:00Z');
check('7days', $fmt(Dates::periodStart('7days', null, $winter)['from']), '2026-11-03T23:30:00Z');
check('all', Dates::periodStart('all', null, $winter), ['from' => null, 'fallback' => false]);
check('sprint met datum (CET)', $fmt(Dates::periodStart('sprint', '2026-11-02', $winter)['from']), '2026-11-01T23:00:00Z');
check('sprint zonder datum → fallback', Dates::periodStart('sprint', null, $winter), ['from' => null, 'fallback' => true]);

echo $failures === 0 ? "\nAlles OK\n" : "\n{$failures} test(s) mislukt\n";
exit($failures === 0 ? 0 : 1);
