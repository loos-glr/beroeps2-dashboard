<?php

declare(strict_types=1);

namespace App\Services;

use App\Config\Config;
use App\Http\HttpException;
use Closure;
use DateTimeImmutable;
use PDO;

/**
 * Laag 1 (team_snapshots met TTL) bovenop de ETag-cache van GitHubClientService, plus de
 * altijd-live verrijking met studentidentiteiten (enrichAndMergeStudents).
 */
final class TeamAnalyticsService
{
    public const SNAPSHOT_VERSION = 1;

    private const ENDPOINTS = [
        'commits' => 'commits?per_page=100',
        'pulls' => 'pulls?state=all&per_page=100',
        'issues' => 'issues?state=all&per_page=100',
        'branches' => 'branches?per_page=100',
        'collaborators' => 'collaborators?per_page=100',
    ];

    /** @param Closure(): PDO $db */
    public function __construct(
        private readonly Closure $db,
        private readonly GitHubClientService $github,
        private readonly Config $config,
    ) {
    }

    /* ===== Publieke API ===== */

    /** @return array{team: array<string, mixed>, github: array<string, mixed>, requests: array<string, int>} */
    public function getTeamDashboardData(int $teamId, bool $forceRefresh = false): array
    {
        $rows = $this->loadTeamRows('t.id = :id', ['id' => $teamId]);
        if ($rows === []) {
            throw new HttpException(404, 'Team niet gevonden');
        }
        $run = $this->run($rows, $forceRefresh);
        return ['team' => $run['teams'][0], 'github' => $run['github'], 'requests' => $run['requests']];
    }

    /** @return array<string, mixed> */
    public function getContextDashboardData(int $contextId, bool $forceRefresh = false): array
    {
        $context = (new ContextService($this->db))->find($contextId);
        $rows = $this->loadTeamRows('t.context_id = :id', ['id' => $contextId]);
        $run = $this->run($rows, $forceRefresh);

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
            'github' => $run['github'],
            'requests' => $run['requests'],
            'kpis' => $kpis,
            'teams' => $run['teams'],
        ];
    }

    /* ===== Pipeline: rijen laden → verlopen teams verversen → identiteiten → verrijken ===== */

    /**
     * @param array<string, mixed> $params
     * @return list<array<string, mixed>>
     */
    private function loadTeamRows(string $where, array $params): array
    {
        // De TTL-controle gebeurt in SQL (UTC), dus geen PHP/DB-tijdzoneverschil
        $stmt = ($this->db)()->prepare(
            "SELECT t.id, t.context_id, t.team_name, t.repo_full_name,
                    c.cache_ttl_minutes, c.inactivity_threshold_days,
                    s.payload_json, s.fetched_at,
                    (s.fetched_at IS NOT NULL
                     AND s.fetched_at > UTC_TIMESTAMP() - INTERVAL c.cache_ttl_minutes MINUTE) AS is_fresh
             FROM teams t
             JOIN academic_contexts c ON c.id = t.context_id
             LEFT JOIN team_snapshots s ON s.team_id = t.id
             WHERE {$where}
             ORDER BY t.team_name, t.id"
        );
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** @return array<string, mixed>|null */
    private static function decode(?string $json): ?array
    {
        if ($json === null || $json === '') {
            return null;
        }
        $data = json_decode($json, true);
        return is_array($data) ? $data : null;
    }

    /** @param array<string, mixed>|null $snap */
    private function usable(?array $snap): bool
    {
        return $snap !== null
            && ($snap['schemaVersion'] ?? 0) === self::SNAPSHOT_VERSION
            && ($snap['authenticated'] ?? null) === ($this->github->authMode() !== 'anonymous')
            && ($snap['teacher'] ?? null) === $this->config->teacherGithubUsername;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return array{teams: list<array<string, mixed>>, github: array<string, mixed>, requests: array<string, int>}
     */
    private function run(array $rows, bool $force): array
    {
        $now = Dates::now();
        $states = [];
        $stale = [];
        foreach ($rows as $row) {
            $snap = self::decode($row['payload_json']);
            $fresh = !$force && (int) $row['is_fresh'] === 1 && $this->usable($snap);
            $states[(int) $row['id']] = [
                'row' => $row, 'snapshot' => $snap, 'fetchedAt' => $row['fetched_at'],
                'status' => $fresh ? 'fresh' : 'refreshed', 'error' => null,
            ];
            if (!$fresh) {
                $stale[] = (int) $row['id'];
            }
        }
        $requests = ['made' => 0, 'notModified' => 0, 'fromSnapshot' => count($rows) - count($stale)];

        if ($stale !== []) {
            $this->refresh($states, $stale, $requests);
        }

        // Identiteiten: één query voor alle teams
        $identifiers = [];
        $expected = $this->loadExpectedMembers(array_keys($states));
        foreach ($states as $id => $state) {
            $snap = $state['snapshot'];
            if ($snap === null) {
                continue;
            }
            foreach (array_merge(array_keys($snap['accounts'] ?? []), $snap['collaborators'] ?? [], $expected[$id] ?? []) as $ident) {
                $identifiers[GitHubIdentifier::normalize((string) $ident)] = true;
            }
        }
        $identityMap = $this->loadIdentityMap(array_map('strval', array_keys($identifiers)));

        $teams = [];
        foreach ($states as $id => $state) {
            $row = $state['row'];
            $snap = $state['snapshot'];
            $members = $snap === null ? [] : self::enrichAndMergeStudents(
                $snap, $identityMap, $expected[$id] ?? [], $this->config->teacherGithubUsername,
                (int) $row['inactivity_threshold_days'], $now
            );
            $counts = ['green' => 0, 'amber' => 0, 'red' => 0];
            foreach ($members as $m) {
                $counts[$m['status']['level']]++;
            }
            $teams[] = [
                'id' => $id,
                'teamName' => $row['team_name'],
                'repo' => $row['repo_full_name'],
                'expectedMembers' => $expected[$id] ?? [],
                'fetchedAt' => Dates::fromDb($state['fetchedAt']),
                'cacheStatus' => $state['status'],
                'error' => $state['error'],
                'collaboratorsDetected' => $snap['collaboratorsDetected'] ?? false,
                'warnings' => $snap['warnings'] ?? [],
                'truncated' => $snap['truncated'] ?? new \stdClass(),
                'totals' => $snap['totals'] ?? null,
                'statusCounts' => $counts,
                'members' => $members,
            ];
        }

        return [
            'teams' => $teams,
            'github' => ['authMode' => $this->github->authMode(), 'rateLimit' => $this->github->lastRateLimit()],
            'requests' => $requests,
        ];
    }

    /**
     * Haalt de 5 endpoints op voor verlopen teams (één parallelle ronde) en werkt de snapshots bij.
     * Een fout bij één team laat de andere teams ongemoeid.
     *
     * @param array<int, array<string, mixed>> $states
     * @param list<int> $stale
     * @param array<string, int> $requests
     */
    private function refresh(array &$states, array $stale, array &$requests): void
    {
        $pdo = ($this->db)();
        $locks = [];
        try {
            $toFetch = [];
            foreach ($stale as $id) {
                // Twee gelijktijdige verversingen van hetzelfde team: de tweede wacht en hergebruikt het resultaat
                $name = 'glr_team_refresh_' . $id;
                $lock = $pdo->prepare('SELECT GET_LOCK(:n, 10)');
                $lock->execute(['n' => $name]);
                if ((int) $lock->fetchColumn() === 1) {
                    $locks[] = $name;
                }

                $re = $pdo->prepare('SELECT payload_json, fetched_at FROM team_snapshots WHERE team_id = :t');
                $re->execute(['t' => $id]);
                $current = $re->fetch();
                if ($current !== false && $current['fetched_at'] !== $states[$id]['fetchedAt']) {
                    $snap = self::decode($current['payload_json']);
                    if ($this->usable($snap)) {
                        $states[$id]['snapshot'] = $snap;
                        $states[$id]['fetchedAt'] = $current['fetched_at'];
                        $states[$id]['status'] = 'fresh';
                        $requests['fromSnapshot']++;
                        continue;
                    }
                }
                $toFetch[] = $id;
            }

            $urls = [];
            foreach ($toFetch as $id) {
                foreach (self::ENDPOINTS as $ep => $path) {
                    $urls["{$id}|{$ep}"] = GitHubClientService::repoUrl($states[$id]['row']['repo_full_name'], $path);
                }
            }
            $results = $urls === [] ? [] : $this->github->fetchAll($urls);

            foreach ($toFetch as $id) {
                $res = [];
                foreach (array_keys(self::ENDPOINTS) as $ep) {
                    $r = $results["{$id}|{$ep}"];
                    $requests['made']++;
                    if (is_array($r) && $r['notModified']) {
                        $requests['notModified']++;
                    }
                    $res[$ep] = $r;
                }
                $this->applyResults($states[$id], $id, $res);
            }
        } finally {
            foreach ($locks as $name) {
                $rel = $pdo->prepare('SELECT RELEASE_LOCK(:n)');
                $rel->execute(['n' => $name]);
            }
        }
    }

    /**
     * @param array<string, mixed> $state
     * @param array<string, array<string, mixed>|GitHubApiException> $res
     */
    private function applyResults(array &$state, int $id, array $res): void
    {
        $pdo = ($this->db)();
        $commits = $res['commits'];
        if ($commits instanceof GitHubApiException && $commits->status !== 409) {
            // Teamfout: een bestaande snapshot blijft zichtbaar, andere teams zijn niet geraakt
            $state['error'] = $commits->toHttpException()->getMessage();
            $state['status'] = $state['snapshot'] !== null ? 'stale-error' : 'error';
            return;
        }

        $authenticated = $this->github->authMode() !== 'anonymous';
        $allNotModified = true;
        foreach ($res as $r) {
            if (!is_array($r) || !$r['notModified']) {
                $allNotModified = false;
            }
        }
        if ($allNotModified && $this->usable($state['snapshot'])) {
            // Niets veranderd op GitHub: alleen de TTL verlengen
            $pdo->prepare('UPDATE team_snapshots SET fetched_at = UTC_TIMESTAMP() WHERE team_id = :t')->execute(['t' => $id]);
            $state['fetchedAt'] = Dates::now()->format('Y-m-d H:i:s');
            return;
        }

        $warnings = [];
        $truncated = [];
        $raw = [];
        foreach (['commits', 'pulls', 'issues', 'branches', 'collaborators'] as $ep) {
            $r = $res[$ep];
            if ($r instanceof GitHubApiException) {
                $raw[$ep] = $ep === 'collaborators' ? null : [];
                if ($ep === 'collaborators' ? !in_array($r->status, [401, 403, 404], true) : ($ep !== 'commits')) {
                    $warnings[] = ['endpoint' => $ep, 'status' => $r->status];
                }
                $truncated[$ep] = false;
                continue;
            }
            $raw[$ep] = is_array($r['data']) ? $r['data'] : [];
            $truncated[$ep] = $r['truncated'];
        }
        unset($truncated['collaborators']);

        $fetchedAt = Dates::now();
        $snapshot = self::buildSnapshot(
            $state['row']['repo_full_name'], $raw, $this->config->teacherGithubUsername,
            $authenticated, $fetchedAt->format('Y-m-d\TH:i:s\Z'), $truncated, $warnings
        );
        $pdo->prepare(
            'INSERT INTO team_snapshots (team_id, payload_json, fetched_at) VALUES (:t, :p, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), fetched_at = VALUES(fetched_at)'
        )->execute(['t' => $id, 'p' => json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)]);

        $state['snapshot'] = $snapshot;
        $state['fetchedAt'] = $fetchedAt->format('Y-m-d H:i:s');
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

    /* ===== Snapshot bouwen (puur) ===== */

    /**
     * @param array{commits: array, pulls: array, issues: array, branches: array, collaborators: ?array} $raw
     * @param array<string, bool> $truncated
     * @param list<array<string, mixed>> $warnings
     * @return array<string, mixed>
     */
    public static function buildSnapshot(
        string $repo,
        array $raw,
        string $teacher,
        bool $authenticated,
        string $fetchedAt,
        array $truncated = [],
        array $warnings = [],
    ): array {
        $accounts = [];
        $issueMap = [];

        $memberFor = static function (string $login, ?string $avatar, bool $isGitName = false, ?string $type = null) use (&$accounts, $teacher): ?string {
            $key = GitHubIdentifier::normalize($login);
            if ($key === '' || ($teacher !== '' && $key === $teacher) || GitHubIdentifier::isBot($login, $type)) {
                return null;
            }
            $accounts[$key] ??= [
                'login' => $login, 'avatar' => null, 'isGitName' => $isGitName, 'lastActive' => null,
                'commits' => [], 'prs' => [], 'createdIssues' => [], 'assignedIssues' => [],
            ];
            if ($avatar !== null && $accounts[$key]['avatar'] === null) {
                $accounts[$key]['avatar'] = $avatar;
            }
            return $key;
        };
        $touch = static function (string $key, ?string $date) use (&$accounts): void {
            if ($date !== null && $date !== '' && ($accounts[$key]['lastActive'] === null || strtotime($date) > strtotime($accounts[$key]['lastActive']))) {
                $accounts[$key]['lastActive'] = $date;
            }
        };

        // Collaborators eerst, zodat studenten met 0 bijdragen zichtbaar zijn
        $collaborators = [];
        foreach ($raw['collaborators'] ?? [] as $user) {
            if (is_array($user) && isset($user['login'])) {
                $key = $memberFor((string) $user['login'], $user['avatar_url'] ?? null, false, $user['type'] ?? null);
                if ($key !== null) {
                    $collaborators[] = $key;
                }
            }
        }

        foreach ($raw['commits'] ?? [] as $c) {
            if (!is_array($c)) {
                continue;
            }
            $author = is_array($c['author'] ?? null) ? $c['author'] : null;
            if ($author !== null && isset($author['login'])) {
                $login = (string) $author['login'];
                $key = $memberFor($login, $author['avatar_url'] ?? null, false, $author['type'] ?? null);
            } else {
                $login = (string) ($c['commit']['author']['name'] ?? '') ?: 'onbekend';
                $key = $memberFor($login, null, true);
            }
            if ($key === null) {
                continue;
            }
            $message = (string) (($c['commit']['message'] ?? '') ?: '(Geen commit message)');
            [$first, $rest] = array_pad(explode("\n", $message, 2), 2, '');
            $sha = (string) ($c['sha'] ?? '');
            $date = $c['commit']['author']['date'] ?? null;
            $accounts[$key]['commits'][] = [
                'sha' => $sha,
                'shortSha' => $sha !== '' ? substr($sha, 0, 7) : '–',
                'authorHandle' => $login,
                'title' => trim($first),
                'body' => mb_substr(trim($rest), 0, 2000),
                'date' => $date,
                'url' => $c['html_url'] ?? null,
            ];
            $touch($key, $date);
        }

        foreach ($raw['pulls'] ?? [] as $pr) {
            if (!is_array($pr) || !is_array($pr['user'] ?? null) || !isset($pr['user']['login'])) {
                continue;
            }
            $key = $memberFor((string) $pr['user']['login'], $pr['user']['avatar_url'] ?? null, false, $pr['user']['type'] ?? null);
            if ($key === null) {
                continue;
            }
            $accounts[$key]['prs'][] = [
                'number' => (int) $pr['number'],
                'title' => (string) ($pr['title'] ?? ''),
                'authorHandle' => (string) $pr['user']['login'],
                'state' => !empty($pr['merged_at']) ? 'merged' : (string) ($pr['state'] ?? 'open'),
                'createdAt' => $pr['created_at'] ?? null,
                'updatedAt' => $pr['updated_at'] ?? null,
                'mergedAt' => $pr['merged_at'] ?? null,
                'url' => $pr['html_url'] ?? null,
                'headRef' => (string) ($pr['head']['ref'] ?? ''),
                'baseRef' => (string) ($pr['base']['ref'] ?? ''),
            ];
            $touch($key, ($pr['updated_at'] ?? null) ?: ($pr['created_at'] ?? null));
        }

        // /issues levert ook Pull Requests terug (herkenbaar aan 'pull_request'); die tellen nooit als issue
        $pureIssues = array_values(array_filter(
            $raw['issues'] ?? [],
            static fn ($i): bool => is_array($i) && !array_key_exists('pull_request', $i) && isset($i['number'])
        ));
        foreach ($pureIssues as $issue) {
            $n = (int) $issue['number'];
            $issueMap[$n] = [
                'number' => $n,
                'title' => (string) ($issue['title'] ?? ''),
                'state' => (string) ($issue['state'] ?? 'open'),
                'createdAt' => $issue['created_at'] ?? null,
                'updatedAt' => $issue['updated_at'] ?? null,
                'closedAt' => $issue['closed_at'] ?? null,
                'labels' => array_values(array_filter(array_map(
                    static fn ($l) => is_string($l) ? $l : ($l['name'] ?? null),
                    is_array($issue['labels'] ?? null) ? $issue['labels'] : []
                ))),
                'url' => $issue['html_url'] ?? null,
            ];

            if (is_array($issue['user'] ?? null) && isset($issue['user']['login'])) {
                $key = $memberFor((string) $issue['user']['login'], $issue['user']['avatar_url'] ?? null, false, $issue['user']['type'] ?? null);
                if ($key !== null) {
                    $accounts[$key]['createdIssues'][] = $n;
                    $touch($key, ($issue['created_at'] ?? null) ?: ($issue['updated_at'] ?? null));
                }
            }
            $assignees = !empty($issue['assignees']) && is_array($issue['assignees'])
                ? $issue['assignees']
                : (is_array($issue['assignee'] ?? null) ? [$issue['assignee']] : []);
            foreach ($assignees as $a) {
                if (is_array($a) && isset($a['login'])) {
                    $key = $memberFor((string) $a['login'], $a['avatar_url'] ?? null, false, $a['type'] ?? null);
                    if ($key !== null) {
                        $accounts[$key]['assignedIssues'][] = $n;
                    }
                }
            }
        }

        foreach ($accounts as &$acc) {
            usort($acc['commits'], static fn ($a, $b) => strtotime((string) $b['date']) <=> strtotime((string) $a['date']));
            usort($acc['prs'], static fn ($a, $b) => strtotime((string) ($b['updatedAt'] ?: $b['createdAt'])) <=> strtotime((string) ($a['updatedAt'] ?: $a['createdAt'])));
            $acc['createdIssues'] = array_values(array_unique($acc['createdIssues']));
            $acc['assignedIssues'] = array_values(array_unique($acc['assignedIssues']));
        }
        unset($acc);

        return [
            'schemaVersion' => self::SNAPSHOT_VERSION,
            'repo' => $repo,
            'fetchedAt' => $fetchedAt,
            'authenticated' => $authenticated,
            'teacher' => $teacher,
            'collaboratorsDetected' => $raw['collaborators'] !== null,
            'collaborators' => array_values(array_unique($collaborators)),
            'totals' => [
                'commits' => count($raw['commits'] ?? []),
                'prs' => count($raw['pulls'] ?? []),
                'issues' => count($pureIssues),
                'openIssues' => count(array_filter($pureIssues, static fn ($i) => ($i['state'] ?? '') === 'open')),
                'branches' => count($raw['branches'] ?? []),
            ],
            'truncated' => $truncated + ['commits' => false, 'pulls' => false, 'issues' => false, 'branches' => false],
            'warnings' => $warnings,
            'accounts' => $accounts,
            'issues' => $issueMap,
        ];
    }

    /* ===== Live verrijking & ontdubbeling (puur) ===== */

    /**
     * Voegt accounts die aan dezelfde student gekoppeld zijn samen. Geen GitHub- of DB-toegang,
     * zodat naamwijzigingen en koppelingen direct zichtbaar zijn.
     *
     * @param array<string, mixed> $snapshot
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
                    'commits' => [], 'prs' => [], 'createdIssues' => [], 'assignedIssues' => [],
                ];
            }
        }

        $groups = [];
        foreach ($accounts as $id => $acc) {
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

        foreach ($accounts as $acc) {
            foreach ($acc['commits'] as $c) {
                // Commits zonder sha kunnen we niet ontdubbelen en tellen altijd mee
                ($c['sha'] ?? '') === '' ? $commits[] = $c : $commits['c:' . $c['sha']] ??= $c;
            }
            foreach ($acc['prs'] as $pr) {
                $prs[(int) $pr['number']] ??= $pr;
            }
            foreach ($acc['createdIssues'] as $n) {
                $created[(int) $n] = true;
            }
            foreach ($acc['assignedIssues'] as $n) {
                $assigned[(int) $n] = true;
            }
            if ($acc['lastActive'] !== null && ($lastActive === null || strtotime($acc['lastActive']) > strtotime($lastActive))) {
                $lastActive = $acc['lastActive'];
            }
        }

        $commits = array_values($commits);
        $prs = array_values($prs);
        usort($commits, static fn ($a, $b) => strtotime((string) $b['date']) <=> strtotime((string) $a['date']));
        usort($prs, static fn ($a, $b) => strtotime((string) ($b['updatedAt'] ?: $b['createdAt'])) <=> strtotime((string) ($a['updatedAt'] ?: $a['createdAt'])));

        $lookup = static function (array $set) use ($issues): array {
            $list = array_values(array_filter(array_map(static fn ($n) => $issues[$n] ?? null, array_keys($set))));
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
                $score = count($acc['commits']) + count($acc['prs']);
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
            'commits' => count($commits),
            'prsCreated' => count($prs),
            'prsMerged' => count(array_filter($prs, static fn ($p) => $p['state'] === 'merged')),
            'prsOpen' => count(array_filter($prs, static fn ($p) => $p['state'] === 'open')),
            'issuesCreated' => count($createdList),
            'issuesAssigned' => count($assignedList),
            'issuesAssignedOpen' => count($assignedOpen),
            'issuesAssignedClosed' => count($assignedClosed),
        ];
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
            'isExpectedOnly' => $totals['commits'] + $totals['prsCreated'] + $totals['issuesCreated'] + $totals['issuesAssigned'] === 0,
            'avatar' => $avatar,
            'lastActive' => $lastActive,
            'daysInactive' => $daysInactive,
            'status' => self::evaluateStatus($totals, $daysInactive, $thresholdDays),
            'totals' => $totals,
            'latestCommit' => $commits[0] ?? null,
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
