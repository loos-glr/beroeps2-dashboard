<?php

declare(strict_types=1);

namespace App\Services;

use App\Config\Config;
use App\Http\HttpException;
use Closure;
use DateTimeImmutable;
use PDO;

/**
 * Dashboardcijfers uit de lokale repo_*-tabellen. Verlopen teams worden eerst incrementeel gesynct
 * via GitHubGraphQLService (TTL = academic_contexts.cache_ttl_minutes); daarna worden periode-filter,
 * ontdubbeling en studentstatus puur uit MariaDB berekend, dus zonder extra GitHub-calls.
 */
final class TeamAnalyticsService
{
    private const RECENT_COMMITS = 15;

    /** @param Closure(): PDO $db */
    public function __construct(
        private readonly Closure $db,
        private readonly GitHubClientService $github,
        private readonly GitHubGraphQLService $graphql,
        private readonly Config $config,
        private readonly ?CoachingLogService $coaching = null,
    ) {
    }

    /* ===== Publieke API ===== */

    /** @return array{team: array<string, mixed>, github: array<string, mixed>, sync: array<string, int>, period: array<string, mixed>} */
    public function getTeamDashboardData(int $teamId, bool $forceRefresh = true, string $period = 'all'): array
    {
        $rows = $this->loadTeamRows('t.id = :id', ['id' => $teamId]);
        if ($rows === []) {
            throw new HttpException(404, 'Team niet gevonden');
        }
        $run = $this->run($rows, $forceRefresh, true, $period);
        return ['team' => $run['teams'][0], 'github' => $run['github'], 'sync' => $run['sync'], 'period' => $run['period']];
    }

    /** @return array<string, mixed> */
    public function getContextDashboardData(int $contextId, bool $forceRefresh = false, string $period = 'all', bool $sync = true): array
    {
        $context = (new ContextService($this->db))->find($contextId);
        $rows = $this->loadTeamRows('t.context_id = :id', ['id' => $contextId]);
        $run = $this->run($rows, $forceRefresh, $sync, $period);

        $kpis = ['teams' => count($run['teams']), 'students' => 0, 'green' => 0, 'amber' => 0, 'red' => 0,
            'commits' => 0, 'prs' => 0, 'openIssues' => 0];
        foreach ($run['teams'] as $team) {
            $kpis['students'] += count($team['members']);
            foreach (['green', 'amber', 'red'] as $level) {
                $kpis[$level] += $team['statusCounts'][$level];
            }
            $kpis['commits'] += $team['totals']['commits'] ?? 0;
            $kpis['prs'] += $team['totals']['prs'] ?? 0;
            $kpis['openIssues'] += $team['totals']['openIssues'] ?? 0;
        }

        return [
            'context' => $context,
            'generatedAt' => Dates::now()->format('Y-m-d\TH:i:s\Z'),
            'period' => $run['period'],
            'github' => $run['github'],
            'sync' => $run['sync'],
            'kpis' => $kpis,
            'teams' => $run['teams'],
        ];
    }

    /* ===== Pipeline: laden → verlopen teams syncen → aggregeren uit SQL → verrijken ===== */

    /**
     * @param array<string, mixed> $params
     * @return list<array<string, mixed>>
     */
    private function loadTeamRows(string $where, array $params): array
    {
        // De TTL-controle gebeurt in SQL (UTC), dus geen PHP/DB-tijdzoneverschil
        $stmt = ($this->db)()->prepare(
            "SELECT t.id, t.context_id, t.team_name, t.repo_full_name, t.last_synced_at, t.collaborators_synced_at,
                    t.collaborators_detected, t.branch_count, t.last_sync_cost,
                    c.cache_ttl_minutes, c.inactivity_threshold_days, c.sprint_start_date,
                    (t.last_synced_at IS NOT NULL
                     AND t.last_synced_at > UTC_TIMESTAMP() - INTERVAL c.cache_ttl_minutes MINUTE) AS is_fresh
             FROM teams t
             JOIN academic_contexts c ON c.id = t.context_id
             WHERE {$where}
             ORDER BY t.team_name, t.id"
        );
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return array{teams: list<array<string, mixed>>, github: array<string, mixed>, sync: array<string, int>, period: array<string, mixed>}
     */
    private function run(array $rows, bool $force, bool $sync, string $period): array
    {
        $now = Dates::now();
        $errors = [];
        $syncedIds = [];
        $cost = 0;

        if ($sync && $rows !== []) {
            $stale = array_values(array_filter($rows, static fn (array $r) => $force || (int) $r['is_fresh'] !== 1));
            if ($stale !== []) {
                [$syncedIds, $errors, $cost] = $this->refresh($stale, $force);
                $ids = implode(',', array_map(static fn ($r) => (int) $r['id'], $rows));
                $rows = $this->loadTeamRows("t.id IN ({$ids})", []);
            }
        }

        $sprintStart = $rows[0]['sprint_start_date'] ?? null;
        $window = Dates::periodStart($period, $sprintStart, $now);
        $from = $window['from'];

        $ids = array_map(static fn ($r) => (int) $r['id'], $rows);
        $data = $this->loadActivity($ids, $from);
        $expected = $this->loadExpectedMembers($ids);

        $identifiers = [];
        foreach ($ids as $id) {
            $snap = $data[$id];
            foreach (array_merge(array_keys($snap['accounts']), $snap['collaborators'], $expected[$id] ?? []) as $ident) {
                $identifiers[GitHubIdentifier::normalize((string) $ident)] = true;
            }
        }
        $identityMap = $this->loadIdentityMap(array_map('strval', array_keys($identifiers)));

        $coaching = $rows === [] || $this->coaching === null
            ? ['teams' => [], 'students' => []]
            : $this->coaching->summaries((int) $rows[0]['context_id'], $now);
        $none = CoachingLogService::emptySummary();

        $teams = [];
        foreach ($rows as $row) {
            $id = (int) $row['id'];
            $snap = $data[$id];
            $synced = $row['last_synced_at'] !== null;
            $error = $errors[$id] ?? (!$synced ? 'Nog niet gesynchroniseerd' : null);
            $status = match (true) {
                isset($errors[$id]) => $synced ? 'stale-error' : 'error',
                in_array($id, $syncedIds, true) => 'refreshed',
                $synced => 'fresh',
                default => 'error',
            };

            $members = $synced ? self::enrichAndMergeStudents(
                $snap, $identityMap, $expected[$id] ?? [], $this->config->teacherGithubUsername,
                (int) $row['inactivity_threshold_days'], $now
            ) : [];
            foreach ($members as &$m) {
                $m['coaching'] = isset($m['student']['id']) ? ($coaching['students'][$m['student']['id']] ?? $none) : $none;
            }
            unset($m);
            $counts = ['green' => 0, 'amber' => 0, 'red' => 0];
            foreach ($members as $m) {
                $counts[$m['status']['level']]++;
            }
            $teams[] = [
                'id' => $id,
                'teamName' => $row['team_name'],
                'repo' => $row['repo_full_name'],
                'expectedMembers' => $expected[$id] ?? [],
                'fetchedAt' => Dates::fromDb($row['last_synced_at']),
                'cacheStatus' => $status,
                'error' => $error,
                'syncCost' => $row['last_sync_cost'] === null ? null : (int) $row['last_sync_cost'],
                'collaboratorsDetected' => (int) ($row['collaborators_detected'] ?? 0) === 1,
                'totals' => $synced ? $snap['totals'] + ['branches' => (int) $row['branch_count']] : null,
                'statusCounts' => $counts,
                'needsSync' => (int) $row['is_fresh'] !== 1,
                'coaching' => $coaching['teams'][$id] ?? $none,
                'members' => $members,
            ];
        }

        return [
            'teams' => $teams,
            'period' => [
                'key' => $period,
                'from' => $from?->format('Y-m-d\TH:i:s\Z'),
                'fallback' => $window['fallback'],
                'sprintStartDate' => $sprintStart,
            ],
            'github' => [
                'authMode' => $this->github->authMode(),
                'rateLimit' => $this->github->lastRateLimit(),
                'graphql' => $this->graphql->lastRateLimit(),
            ],
            'sync' => [
                'synced' => count($syncedIds),
                'fromDb' => count($rows) - count($syncedIds),
                'failed' => count($errors),
                'cost' => $cost,
            ],
        ];
    }

    /**
     * Synchroniseert verlopen teams. Twee gelijktijdige verversingen van hetzelfde team: de tweede wacht
     * op de lock en hergebruikt daarna het resultaat van de eerste.
     *
     * @param list<array<string, mixed>> $stale
     * @return array{0: list<int>, 1: array<int, string>, 2: int} [gesyncte ids, fouten per team, totale kosten]
     */
    private function refresh(array $stale, bool $force): array
    {
        $pdo = ($this->db)();
        $locks = [];
        try {
            $todo = [];
            foreach ($stale as $row) {
                $id = (int) $row['id'];
                $name = 'glr_team_refresh_' . $id;
                $lock = $pdo->prepare('SELECT GET_LOCK(:n, 10)');
                $lock->execute(['n' => $name]);
                if ((int) $lock->fetchColumn() === 1) {
                    $locks[] = $name;
                }
                if (!$force) {
                    $re = $pdo->prepare(
                        'SELECT t.last_synced_at > UTC_TIMESTAMP() - INTERVAL c.cache_ttl_minutes MINUTE
                         FROM teams t JOIN academic_contexts c ON c.id = t.context_id WHERE t.id = :t'
                    );
                    $re->execute(['t' => $id]);
                    if ((int) $re->fetchColumn() === 1) {
                        continue;     // intussen door een andere request ververst
                    }
                }
                $todo[] = $row;
            }

            $synced = [];
            $errors = [];
            $cost = 0;
            foreach ($this->graphql->syncTeams($todo, $force) as $id => $res) {
                $cost += $res['cost'];
                if ($res['ok']) {
                    $synced[] = $id;
                } else {
                    $errors[$id] = (string) $res['error'];
                }
            }
            return [$synced, $errors, $cost];
        } finally {
            foreach ($locks as $name) {
                $rel = $pdo->prepare('SELECT RELEASE_LOCK(:n)');
                $rel->execute(['n' => $name]);
            }
        }
    }

    /**
     * Haalt de activiteit van alle teams uit de repo_*-tabellen (een handvol queries, ongeacht het aantal teams).
     *
     * @param list<int> $ids
     * @return array<int, array<string, mixed>> team_id => buildAccounts()-resultaat
     */
    private function loadActivity(array $ids, ?DateTimeImmutable $from): array
    {
        if ($ids === []) {
            return [];
        }
        $out = [];
        foreach ($ids as $id) {
            $out[$id] = ['agg' => [], 'recent' => [], 'prs' => [], 'issues' => [], 'collabs' => []];
        }
        $pdo = ($this->db)();
        $in = implode(',', array_fill(0, count($ids), '?'));
        $fromStr = ($from ?? new DateTimeImmutable('1970-01-01T00:00:00Z'))->format('Y-m-d H:i:s');

        $q = $pdo->prepare(
            "SELECT team_id, author_identifier, COUNT(*) AS total, SUM(committed_at >= ?) AS in_period,
                    MAX(committed_at) AS last_at, MAX(author_avatar) AS avatar
             FROM repo_commits WHERE team_id IN ({$in}) GROUP BY team_id, author_identifier"
        );
        $q->execute([$fromStr, ...$ids]);
        foreach ($q->fetchAll() as $r) {
            $out[(int) $r['team_id']]['agg'][] = $r;
        }

        // Window functions mogen niet direct in WHERE: daarom een afgeleide tabel met rn
        $q = $pdo->prepare(
            "SELECT team_id, author_identifier, sha, message_headline, message_body, committed_at, commit_url
             FROM (
               SELECT team_id, author_identifier, sha, message_headline, message_body, committed_at, commit_url,
                      ROW_NUMBER() OVER (PARTITION BY team_id, author_identifier ORDER BY committed_at DESC, sha) AS rn
               FROM repo_commits WHERE team_id IN ({$in})
             ) x
             WHERE rn <= " . self::RECENT_COMMITS . '
             ORDER BY team_id, author_identifier, committed_at DESC, sha'
        );
        $q->execute($ids);
        foreach ($q->fetchAll() as $r) {
            $out[(int) $r['team_id']]['recent'][] = $r;
        }

        foreach ([
            'prs' => "SELECT * FROM repo_pull_requests WHERE team_id IN ({$in})",
            'issues' => "SELECT * FROM repo_issues WHERE team_id IN ({$in})",
            'collabs' => "SELECT team_id, login, avatar_url FROM repo_collaborators WHERE team_id IN ({$in}) ORDER BY login",
        ] as $key => $sql) {
            $q = $pdo->prepare($sql);
            $q->execute($ids);
            foreach ($q->fetchAll() as $r) {
                $out[(int) $r['team_id']][$key][] = $r;
            }
        }

        $teacher = $this->config->teacherGithubUsername;
        $result = [];
        foreach ($out as $id => $d) {
            $result[$id] = self::buildAccounts($d['agg'], $d['recent'], $d['prs'], $d['issues'], $d['collabs'], $teacher, $from);
        }
        return $result;
    }

    /* ===== Identiteiten ===== */

    /**
     * @param list<string> $identifiers
     * @return array<string, array{studentId: int, fullName: string, studentNumber: ?string, notes: ?string, linkedHandles: list<string>}>
     */
    private function loadIdentityMap(array $identifiers): array
    {
        if ($identifiers === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($identifiers), '?'));
        $stmt = ($this->db)()->prepare(
            "SELECT a1.github_identifier AS matched, s.id AS student_id, s.full_name, s.student_number, s.notes,
                    a2.github_identifier AS linked
             FROM student_github_accounts a1
             JOIN students s ON s.id = a1.student_id
             JOIN student_github_accounts a2 ON a2.student_id = s.id
             WHERE a1.github_identifier IN ({$in})
             ORDER BY a2.github_identifier"
        );
        $stmt->execute($identifiers);

        $map = [];
        foreach ($stmt->fetchAll() as $r) {
            $map[$r['matched']] ??= [
                'studentId' => (int) $r['student_id'], 'fullName' => $r['full_name'],
                'studentNumber' => $r['student_number'], 'notes' => $r['notes'], 'linkedHandles' => [],
            ];
            $map[$r['matched']]['linkedHandles'][] = $r['linked'];
        }
        return $map;
    }

    /**
     * @param list<int> $teamIds
     * @return array<int, list<string>>
     */
    private function loadExpectedMembers(array $teamIds): array
    {
        if ($teamIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($teamIds), '?'));
        $stmt = ($this->db)()->prepare(
            "SELECT team_id, github_identifier FROM team_expected_members WHERE team_id IN ({$in}) ORDER BY github_identifier"
        );
        $stmt->execute($teamIds);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[(int) $r['team_id']][] = $r['github_identifier'];
        }
        return $out;
    }

    /* ===== Accounts bouwen uit repo_*-rijen (puur) ===== */

    /**
     * Zet de database-rijen van één team om naar accounts per identifier. Docent en bots vallen weg.
     * Alle tijden komen binnen als 'Y-m-d H:i:s' (UTC) en gaan eruit als ISO-8601 met Z.
     *
     * Periode-filter ($from): commits, PR's en aangemaakte issues tellen alleen mee vanaf $from; assigned
     * issues zijn altijd actueel. De *All-velden bevatten de ongefilterde aantallen voor de statusregels.
     *
     * @param list<array<string, mixed>> $agg    COUNT/SUM/MAX per auteur uit repo_commits
     * @param list<array<string, mixed>> $recent  nieuwste commits per auteur (ongefilterd, nieuwste eerst)
     * @param list<array<string, mixed>> $prs     rijen uit repo_pull_requests
     * @param list<array<string, mixed>> $issues  rijen uit repo_issues
     * @param list<array<string, mixed>> $collabs rijen uit repo_collaborators
     * @return array{accounts: array<string, array<string, mixed>>, issues: array<int, array<string, mixed>>, collaborators: list<string>, totals: array<string, int>}
     */
    public static function buildAccounts(
        array $agg,
        array $recent,
        array $prs,
        array $issues,
        array $collabs,
        string $teacher,
        ?DateTimeImmutable $from = null,
    ): array {
        $fromStr = $from?->format('Y-m-d H:i:s');
        $inPeriod = static fn (?string $at): bool => $fromStr === null || ($at !== null && $at >= $fromStr);
        $iso = static fn (?string $v): ?string => Dates::fromDb($v);

        $accounts = [];
        $get = static function (string $ident, ?string $avatar) use (&$accounts, $teacher): ?string {
            $key = GitHubIdentifier::normalize($ident);
            if ($key === '' || ($teacher !== '' && $key === $teacher) || GitHubIdentifier::isBot($key)) {
                return null;
            }
            $accounts[$key] ??= [
                'login' => $key, 'avatar' => null,
                'isGitName' => preg_match('/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/', $key) !== 1,   // "Git Naam" is geen login
                'lastActive' => null,
                'commits' => [], 'commitCount' => 0, 'commitCountAll' => 0, 'latestCommit' => null,
                'prs' => [], 'prCountAll' => 0,
                'createdIssues' => [], 'createdIssuesAll' => 0, 'assignedIssues' => [],
            ];
            if ($avatar !== null && $avatar !== '' && $accounts[$key]['avatar'] === null) {
                $accounts[$key]['avatar'] = $avatar;
            }
            return $key;
        };
        $touch = static function (string $key, ?string $at) use (&$accounts): void {
            if ($at !== null && ($accounts[$key]['lastActive'] === null || $at > $accounts[$key]['lastActive'])) {
                $accounts[$key]['lastActive'] = $at;
            }
        };

        // Collaborators eerst, zodat studenten met 0 bijdragen zichtbaar zijn
        $collaborators = [];
        foreach ($collabs as $c) {
            $key = $get((string) $c['login'], $c['avatar_url'] ?? null);
            if ($key !== null) {
                $collaborators[] = $key;
            }
        }

        $commitTotal = 0;
        foreach ($agg as $r) {
            $key = $get((string) $r['author_identifier'], $r['avatar'] ?? null);
            if ($key === null) {
                continue;
            }
            $accounts[$key]['commitCountAll'] += (int) $r['total'];
            $accounts[$key]['commitCount'] += (int) $r['in_period'];
            $commitTotal += (int) $r['in_period'];
            $touch($key, $r['last_at']);
        }
        foreach ($recent as $c) {
            $key = $get((string) $c['author_identifier'], null);
            if ($key === null) {
                continue;
            }
            $sha = (string) $c['sha'];
            $commit = [
                'sha' => $sha,
                'shortSha' => $sha !== '' ? substr($sha, 0, 7) : '–',
                'authorHandle' => (string) $c['author_identifier'],
                'title' => (string) $c['message_headline'],
                'body' => (string) ($c['message_body'] ?? ''),
                'date' => $iso($c['committed_at']),
                'url' => $c['commit_url'] ?? null,
            ];
            $accounts[$key]['latestCommit'] ??= $commit;
            if ($inPeriod($c['committed_at'])) {
                $accounts[$key]['commits'][] = $commit;
            }
        }

        $prTotal = 0;
        foreach ($prs as $pr) {
            $key = $get((string) $pr['author_identifier'], $pr['author_avatar'] ?? null);
            if ($key === null) {
                continue;
            }
            $accounts[$key]['prCountAll']++;
            $touch($key, $pr['updated_at'] ?: $pr['created_at']);
            if (!$inPeriod($pr['created_at'])) {
                continue;
            }
            $prTotal++;
            $accounts[$key]['prs'][] = [
                'number' => (int) $pr['pr_number'],
                'title' => (string) $pr['title'],
                'authorHandle' => (string) $pr['author_identifier'],
                'state' => strtolower((string) $pr['state']),
                'createdAt' => $iso($pr['created_at']),
                'updatedAt' => $iso($pr['updated_at']),
                'mergedAt' => $iso($pr['merged_at'] ?? null),
                'url' => $pr['pr_url'] ?? null,
                'headRef' => (string) ($pr['head_ref'] ?? ''),
                'baseRef' => (string) ($pr['base_ref'] ?? ''),
            ];
        }

        $issueMap = [];
        $issueCreated = 0;
        $issueOpen = 0;
        foreach ($issues as $i) {
            $n = (int) $i['issue_number'];
            $labels = json_decode((string) ($i['labels_json'] ?? '[]'), true);
            $assignees = json_decode((string) ($i['assignees_json'] ?? '[]'), true);
            $issueMap[$n] = [
                'number' => $n,
                'title' => (string) $i['title'],
                'state' => strtolower((string) $i['state']),
                'createdAt' => $iso($i['created_at']),
                'updatedAt' => $iso($i['updated_at']),
                'closedAt' => $iso($i['closed_at'] ?? null),
                'labels' => array_values(array_filter(array_map(
                    static fn ($l) => is_array($l) ? ($l['name'] ?? null) : (is_string($l) ? $l : null),
                    is_array($labels) ? $labels : []
                ))),
                'url' => $i['issue_url'] ?? null,
            ];
            if (strtoupper((string) $i['state']) === 'OPEN') {
                $issueOpen++;
            }
            $key = $get((string) $i['author_identifier'], $i['author_avatar'] ?? null);
            if ($key !== null) {
                $accounts[$key]['createdIssuesAll']++;
                $touch($key, $i['created_at'] ?: $i['updated_at']);
                if ($inPeriod($i['created_at'])) {
                    $accounts[$key]['createdIssues'][] = $n;
                    $issueCreated++;
                }
            }
            foreach (is_array($assignees) ? $assignees : [] as $login) {
                $a = $get((string) $login, null);
                if ($a !== null) {
                    $accounts[$a]['assignedIssues'][] = $n;
                }
            }
        }

        foreach ($accounts as &$acc) {
            $acc['assignedIssues'] = array_values(array_unique($acc['assignedIssues']));
            $acc['lastActive'] = $iso($acc['lastActive']);
        }
        unset($acc);

        return [
            'accounts' => $accounts,
            'issues' => $issueMap,
            'collaborators' => array_values(array_unique($collaborators)),
            // Teamtotalen tellen alleen studenten (docent en bots uitgesloten); openIssues is altijd actueel
            'totals' => ['commits' => $commitTotal, 'prs' => $prTotal, 'issues' => $issueCreated, 'openIssues' => $issueOpen],
        ];
    }

    /* ===== Live verrijking & ontdubbeling (puur) ===== */

    /**
     * Voegt accounts die aan dezelfde student gekoppeld zijn samen. Geen GitHub- of DB-toegang,
     * zodat naamwijzigingen en koppelingen direct zichtbaar zijn.
     *
     * @param array<string, mixed> $snapshot uitvoer van buildAccounts()
     * @param array<string, array<string, mixed>> $identityMap identifier => student
     * @param list<string> $expected verwachte teamleden (team_expected_members)
     * @return list<array<string, mixed>>
     */
    public static function enrichAndMergeStudents(
        array $snapshot,
        array $identityMap,
        array $expected,
        string $teacher,
        int $thresholdDays,
        DateTimeImmutable $now,
    ): array {
        $accounts = [];
        foreach ($snapshot['accounts'] ?? [] as $id => $acc) {
            $accounts[(string) $id] = $acc;
        }
        $issues = [];
        foreach ($snapshot['issues'] ?? [] as $n => $issue) {
            $issues[(int) $n] = $issue;
        }

        // Collaborators en verwachte leden zonder activiteit horen er ook bij
        foreach (array_merge($snapshot['collaborators'] ?? [], $expected) as $raw) {
            $id = GitHubIdentifier::normalize((string) $raw);
            if ($id !== '' && !isset($accounts[$id])) {
                $accounts[$id] = [
                    'login' => $id, 'avatar' => null, 'isGitName' => false, 'lastActive' => null,
                    'commits' => [], 'commitCount' => 0, 'commitCountAll' => 0, 'latestCommit' => null,
                    'prs' => [], 'prCountAll' => 0, 'createdIssues' => [], 'createdIssuesAll' => 0, 'assignedIssues' => [],
                ];
            }
        }

        $groups = [];
        foreach ($accounts as $id => $acc) {
            $id = (string) $id;      // numerieke logins worden door PHP integer-sleutels
            if (($teacher !== '' && $id === $teacher) || GitHubIdentifier::isBot($id)) {
                continue;
            }
            $ident = $identityMap[$id] ?? null;
            $key = $ident !== null ? 's:' . $ident['studentId'] : 'h:' . $id;
            $groups[$key]['ident'] = $ident;
            $groups[$key]['accounts'][$id] = $acc;
        }

        $members = [];
        foreach ($groups as $key => $group) {
            $members[] = self::mergeGroup((string) $key, $group['ident'], $group['accounts'], $issues, $thresholdDays, $now);
        }
        usort($members, static fn ($a, $b) => [$a['totals']['commits'], $a['displayName']] <=> [$b['totals']['commits'], $b['displayName']]);

        return $members;
    }

    /**
     * @param array<string, mixed>|null $ident
     * @param array<string, array<string, mixed>> $accounts
     * @param array<int, array<string, mixed>> $issues
     * @return array<string, mixed>
     */
    private static function mergeGroup(string $key, ?array $ident, array $accounts, array $issues, int $thresholdDays, DateTimeImmutable $now): array
    {
        $commits = [];
        $prs = [];
        $created = [];
        $assigned = [];
        $lastActive = null;
        $latest = null;
        $n = ['commits' => 0, 'commitsAll' => 0, 'prsAll' => 0, 'issuesAll' => 0];

        foreach ($accounts as $acc) {
            array_push($commits, ...$acc['commits']);
            foreach ($acc['prs'] as $pr) {
                $prs[(int) $pr['number']] ??= $pr;
            }
            foreach ($acc['createdIssues'] as $num) {
                $created[(int) $num] = true;
            }
            foreach ($acc['assignedIssues'] as $num) {
                $assigned[(int) $num] = true;
            }
            $n['commits'] += $acc['commitCount'];
            $n['commitsAll'] += $acc['commitCountAll'];
            $n['prsAll'] += $acc['prCountAll'];
            $n['issuesAll'] += $acc['createdIssuesAll'];
            if ($acc['latestCommit'] !== null && ($latest === null || strtotime((string) $acc['latestCommit']['date']) > strtotime((string) $latest['date']))) {
                $latest = $acc['latestCommit'];
            }
            if ($acc['lastActive'] !== null && ($lastActive === null || strtotime($acc['lastActive']) > strtotime($lastActive))) {
                $lastActive = $acc['lastActive'];
            }
        }

        $prs = array_values($prs);
        usort($commits, static fn ($a, $b) => strtotime((string) $b['date']) <=> strtotime((string) $a['date']));
        $commits = array_slice($commits, 0, self::RECENT_COMMITS);
        usort($prs, static fn ($a, $b) => strtotime((string) ($b['updatedAt'] ?: $b['createdAt'])) <=> strtotime((string) ($a['updatedAt'] ?: $a['createdAt'])));

        $lookup = static function (array $set) use ($issues): array {
            $list = array_values(array_filter(array_map(static fn ($num) => $issues[$num] ?? null, array_keys($set))));
            usort($list, static fn ($a, $b) => strtotime((string) $b['updatedAt']) <=> strtotime((string) $a['updatedAt']));
            return $list;
        };
        $createdList = $lookup($created);
        $assignedList = $lookup($assigned);
        $assignedOpen = array_values(array_filter($assignedList, static fn ($i) => $i['state'] === 'open'));
        $assignedClosed = array_values(array_filter($assignedList, static fn ($i) => $i['state'] !== 'open'));

        // Primair account: echte GitHub-account met de meeste bijdragen (anders het actiefste)
        $primaryId = null;
        $best = -1;
        foreach ([false, true] as $gitNames) {
            foreach ($accounts as $id => $acc) {
                if ($acc['isGitName'] !== $gitNames) {
                    continue;
                }
                $score = $acc['commitCountAll'] + $acc['prCountAll'];
                if ($score > $best) {
                    $best = $score;
                    $primaryId = (string) $id;
                }
            }
            if ($primaryId !== null) {
                break;
            }
        }
        $primaryId ??= (string) array_key_first($accounts);
        $avatar = $accounts[$primaryId]['avatar'];
        if ($avatar === null) {
            foreach ($accounts as $acc) {
                if (!$acc['isGitName'] && $acc['avatar'] !== null) {
                    $avatar = $acc['avatar'];
                    break;
                }
            }
        }

        $totals = [
            'commits' => $n['commits'],
            'prsCreated' => count($prs),
            'prsMerged' => count(array_filter($prs, static fn ($p) => $p['state'] === 'merged')),
            'prsOpen' => count(array_filter($prs, static fn ($p) => $p['state'] === 'open')),
            'issuesCreated' => count($createdList),
            'issuesAssigned' => count($assignedList),
            'issuesAssignedOpen' => count($assignedOpen),
            'issuesAssignedClosed' => count($assignedClosed),
        ];
        // De status kijkt altijd naar alle activiteit, niet naar het gekozen periode-filter
        $totalsAll = ['commits' => $n['commitsAll'], 'prsCreated' => $n['prsAll'], 'issuesCreated' => $n['issuesAll']];
        $daysInactive = $lastActive === null ? null : intdiv(max(0, $now->getTimestamp() - strtotime($lastActive)), 86400);
        $handles = array_values(array_map(static fn ($a) => (string) $a['login'], $accounts));
        $username = (string) $accounts[$primaryId]['login'];

        return [
            'key' => $key,
            'username' => $username,
            'displayName' => $ident['fullName'] ?? $username,
            'student' => $ident === null ? null : [
                'id' => $ident['studentId'], 'fullName' => $ident['fullName'],
                'studentNumber' => $ident['studentNumber'], 'notes' => $ident['notes'],
            ],
            'handles' => $handles,
            'linkedHandles' => $ident['linkedHandles'] ?? [],
            'isMerged' => count($handles) > 1,
            'isExpectedOnly' => $totalsAll['commits'] + $totalsAll['prsCreated'] + $totalsAll['issuesCreated'] + $totals['issuesAssigned'] === 0,
            'avatar' => $avatar,
            'lastActive' => $lastActive,
            'daysInactive' => $daysInactive,
            'status' => self::evaluateStatus($totalsAll, $daysInactive, $thresholdDays),
            'totals' => $totals,
            'totalsAll' => $totalsAll,
            'latestCommit' => $latest,
            'commits' => $commits,
            'pullRequests' => $prs,
            'createdIssues' => $createdList,
            'assignedIssues' => ['open' => $assignedOpen, 'closed' => $assignedClosed],
        ];
    }

    /**
     * Zelfde regels als de frontend (analysis.js · evaluateStudentStatus), met green/amber/red.
     *
     * @param array<string, int> $totals
     * @return array{level: string, reason: string, label: string}
     */
    public static function evaluateStatus(array $totals, ?int $daysInactive, int $thresholdDays): array
    {
        if ($totals['commits'] === 0 && $totals['prsCreated'] === 0) {
            return ['level' => 'red', 'reason' => 'no_code', 'label' => '0 code-bijdragen'];
        }
        if ($daysInactive === null || $daysInactive > $thresholdDays) {
            return ['level' => 'red', 'reason' => 'inactive', 'label' => $daysInactive === null ? 'Geen activiteit' : "{$daysInactive} dagen stil"];
        }
        if ($totals['commits'] > 2 && $totals['prsCreated'] === 0) {
            return ['level' => 'amber', 'reason' => 'no_prs', 'label' => "Geen PR's"];
        }
        return ['level' => 'green', 'reason' => 'on_track', 'label' => 'Op koers'];
    }
}
