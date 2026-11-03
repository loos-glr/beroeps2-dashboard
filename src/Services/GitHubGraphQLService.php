<?php

declare(strict_types=1);

namespace App\Services;

use App\Config\Config;
use Closure;
use CurlHandle;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Throwable;

/**
 * Incrementele sync via GitHub GraphQL v4: één call per team, opslag in repo_commits,
 * repo_pull_requests, repo_issues en repo_collaborators.
 */
final class GitHubGraphQLService
{
    public const ENDPOINT = 'https://api.github.com/graphql';
    private const USER_AGENT = 'GLR-Beroeps2-Dashboard/1.0';
    private const MAX_PARALLEL = 6;
    private const MAX_PAGES = 10;
    private const LOOKBACK = '-30 days';
    private const COLLABORATOR_TTL_HOURS = 24;

    private const QUERY = <<<'GQL'
query($owner: String!, $name: String!, $since: GitTimestamp, $commitAfter: String, $prAfter: String, $issueAfter: String,
      $withCommits: Boolean!, $withPrs: Boolean!, $withIssues: Boolean!, $withCollaborators: Boolean!) {
  rateLimit { limit remaining resetAt cost }
  repository(owner: $owner, name: $name) {
    pushedAt
    refs(refPrefix: "refs/heads/", first: 1) { totalCount }
    defaultBranchRef @include(if: $withCommits) {
      target {
        ... on Commit {
          history(first: 100, since: $since, after: $commitAfter) {
            pageInfo { hasNextPage endCursor }
            nodes { oid messageHeadline messageBody committedDate url author { name avatarUrl user { login avatarUrl } } }
          }
        }
      }
    }
    pullRequests(first: 50, after: $prAfter, orderBy: {field: UPDATED_AT, direction: DESC}) @include(if: $withPrs) {
      pageInfo { hasNextPage endCursor }
      nodes { number title state createdAt updatedAt mergedAt headRefName baseRefName url author { __typename login avatarUrl } }
    }
    issues(first: 50, after: $issueAfter, orderBy: {field: UPDATED_AT, direction: DESC}) @include(if: $withIssues) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state createdAt updatedAt closedAt url
        author { __typename login avatarUrl }
        assignees(first: 10) { nodes { login } }
        labels(first: 20) { nodes { name color } }
      }
    }
    collaborators(first: 100) @include(if: $withCollaborators) { nodes { login avatarUrl } }
  }
}
GQL;

    /** @var array<string, mixed>|null */
    private ?array $lastRateLimit = null;
    private int $costTotal = 0;

    /** @param Closure(): PDO $db */
    public function __construct(
        private readonly Closure $db,
        private readonly GitHubClientService $github,
        private readonly Config $config,
    ) {
    }

    /** @return array<string, mixed>|null laatst geziene rateLimit, plus costTotal van deze request */
    public function lastRateLimit(): ?array
    {
        return $this->lastRateLimit === null ? null : $this->lastRateLimit + ['costTotal' => $this->costTotal];
    }

    /**
     * Synchroniseert teams (één GraphQL-call per team, parallel). Fouten gelden per team.
     *
     * @param list<array<string, mixed>> $teams rijen uit teams (id, repo_full_name, last_synced_at, collaborators_synced_at)
     * @return array<int, array{ok: bool, error: ?string, cost: int}>
     */
    public function syncTeams(array $teams, bool $force): array
    {
        $results = [];
        if ($teams === []) {
            return $results;
        }
        if ($this->github->token() === '') {
            foreach ($teams as $t) {
                $results[(int) $t['id']] = ['ok' => false, 'error' => 'GraphQL vereist een GitHub-token', 'cost' => 0];
            }
            return $results;
        }

        $plans = [];
        foreach ($teams as $t) {
            $plans[(int) $t['id']] = $this->plan($t, $force);
        }

        // Ronde 1 parallel; vervolgpagina's (alleen bij uitzondering) per team daarna
        $responses = $this->postAll(array_map(fn (array $p) => $p['vars'], $plans));
        foreach ($plans as $id => $plan) {
            $results[$id] = $this->finishTeam($id, $plan, $responses[$id]);
        }
        return $results;
    }

    /**
     * @param array<string, mixed> $team
     * @return array{vars: array<string, mixed>, team: array<string, mixed>, collabs: bool}
     */
    private function plan(array $team, bool $force): array
    {
        [$owner, $name] = explode('/', (string) $team['repo_full_name'], 2) + [1 => ''];

        $stmt = ($this->db)()->prepare('SELECT MAX(committed_at) FROM repo_commits WHERE team_id = :t');
        $stmt->execute(['t' => $team['id']]);
        $latest = $stmt->fetchColumn();
        $since = null;
        if (is_string($latest) && $latest !== '') {
            $since = (new DateTimeImmutable($latest, new DateTimeZone('UTC')))->modify(self::LOOKBACK)->format('Y-m-d\TH:i:s\Z');
        }

        $syncedAt = $team['collaborators_synced_at'] ?? null;
        $collabs = $force || $syncedAt === null
            || strtotime((string) $syncedAt . ' UTC') < time() - self::COLLABORATOR_TTL_HOURS * 3600;

        return [
            'team' => $team,
            'collabs' => $collabs,
            'vars' => [
                'owner' => $owner, 'name' => $name, 'since' => $since,
                'commitAfter' => null, 'prAfter' => null, 'issueAfter' => null,
                'withCommits' => true, 'withPrs' => true, 'withIssues' => true, 'withCollaborators' => $collabs,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $plan
     * @param array<string, mixed>|GitHubApiException $first
     * @return array{ok: bool, error: ?string, cost: int}
     */
    private function finishTeam(int $id, array $plan, array|GitHubApiException $first): array
    {
        $cost = 0;
        try {
            if ($first instanceof GitHubApiException) {
                throw $first;
            }
            $data = $first;
            $cost += (int) ($data['data']['rateLimit']['cost'] ?? 0);
            $collabDenied = self::collaboratorsDenied($data);
            $parsed = self::parseRepository((array) ($data['data']['repository'] ?? []), $this->config->teacherGithubUsername);
            $lastSynced = $plan['team']['last_synced_at'] ?? null;

            // Vervolgpagina's: history zolang hasNextPage; PR's/issues zolang er wijzigingen sinds de vorige sync zijn
            $cursors = ['commits' => $parsed['pageInfo']['commits'], 'prs' => $parsed['pageInfo']['prs'], 'issues' => $parsed['pageInfo']['issues']];
            for ($page = 1; $page < self::MAX_PAGES; $page++) {
                $more = [
                    'commits' => $cursors['commits']['hasNextPage'],
                    'prs' => $cursors['prs']['hasNextPage'] && self::pageNeedsMore($parsed['prs'], $lastSynced),
                    'issues' => $cursors['issues']['hasNextPage'] && self::pageNeedsMore($parsed['issues'], $lastSynced),
                ];
                if (!in_array(true, $more, true)) {
                    break;
                }
                $vars = $plan['vars'];
                $vars['withCollaborators'] = false;
                $vars['withCommits'] = $more['commits'];
                $vars['withPrs'] = $more['prs'];
                $vars['withIssues'] = $more['issues'];
                $vars['commitAfter'] = $cursors['commits']['endCursor'];
                $vars['prAfter'] = $cursors['prs']['endCursor'];
                $vars['issueAfter'] = $cursors['issues']['endCursor'];
                $next = $this->postAll([$id => $vars])[$id];
                if ($next instanceof GitHubApiException) {
                    throw $next;
                }
                $cost += (int) ($next['data']['rateLimit']['cost'] ?? 0);
                $extra = self::parseRepository((array) ($next['data']['repository'] ?? []), $this->config->teacherGithubUsername);
                foreach (['commits', 'prs', 'issues'] as $k) {
                    if ($more[$k]) {
                        $parsed[$k] = array_merge($parsed[$k], $extra[$k]);
                        $cursors[$k] = $extra['pageInfo'][$k];
                    } else {
                        $cursors[$k]['hasNextPage'] = false;
                    }
                }
            }

            $this->store($id, $parsed, $plan['collabs'], $collabDenied, $cost);
            return ['ok' => true, 'error' => null, 'cost' => $cost];
        } catch (GitHubApiException $e) {
            return ['ok' => false, 'error' => $e->toHttpException()->getMessage(), 'cost' => $cost];
        } catch (Throwable $e) {
            return ['ok' => false, 'error' => 'Synchroniseren mislukt', 'cost' => $cost];
        }
    }

    /** Is de oudste node van deze lijst nog nieuwer dan de vorige sync? Zo ja, dan kan er een volgende pagina nuttig zijn. */
    private static function pageNeedsMore(array $rows, ?string $lastSynced): bool
    {
        if ($lastSynced === null) {
            return true;      // eerste sync: alles ophalen
        }
        $oldest = $rows === [] ? null : end($rows)['updated_at'];
        return $oldest !== null && $oldest > $lastSynced;
    }

    /* ===== HTTP ===== */

    /**
     * @param array<int|string, array<string, mixed>> $variables sleutel => GraphQL-variabelen
     * @return array<int|string, array<string, mixed>|GitHubApiException>
     */
    private function postAll(array $variables): array
    {
        $out = [];
        $mh = curl_multi_init();
        $handles = [];
        $queue = array_keys($variables);
        $active = [];

        while ($queue !== [] || $active !== []) {
            while ($queue !== [] && count($active) < self::MAX_PARALLEL) {
                $k = array_shift($queue);
                $handles[$k] = $this->newHandle($variables[$k]);
                curl_multi_add_handle($mh, $handles[$k]['ch']);
                $active[$k] = true;
            }
            do {
                $code = curl_multi_exec($mh, $running);
            } while ($code === CURLM_CALL_MULTI_PERFORM);

            while (($info = curl_multi_info_read($mh)) !== false) {
                foreach ($active as $k => $_) {
                    if ($handles[$k]['ch'] !== $info['handle']) {
                        continue;
                    }
                    $ch = $handles[$k]['ch'];
                    $ok = $info['result'] === CURLE_OK;
                    $status = $ok ? (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE) : 0;
                    $body = $ok ? (string) curl_multi_getcontent($ch) : '';
                    $err = $ok ? '' : curl_error($ch);
                    curl_multi_remove_handle($mh, $ch);
                    unset($active[$k]);
                    try {
                        $out[$k] = $this->interpret($status, $handles[$k]['sink'], $body, $err);
                    } catch (GitHubApiException $e) {
                        $out[$k] = $e;
                    }
                    break;
                }
            }
            if ($active !== [] && curl_multi_select($mh, 1.0) === -1) {
                usleep(1000);
            }
        }
        curl_multi_close($mh);
        return $out;
    }

    /** @return array{ch: CurlHandle, sink: array<string, string>} */
    private function newHandle(array $variables): array
    {
        $handle = ['sink' => []];
        $sink = &$handle['sink'];
        $ch = curl_init(self::ENDPOINT);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode(['query' => self::QUERY, 'variables' => $variables], JSON_THROW_ON_ERROR),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'User-Agent: ' . self::USER_AGENT,
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->github->token(),
            ],
            CURLOPT_ENCODING => '',
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$sink): int {
                if (preg_match('#^HTTP/\S+\s+\d{3}#', $line) === 1) {
                    $sink = [];
                } elseif (str_contains($line, ':')) {
                    [$n, $v] = explode(':', $line, 2);
                    $sink[strtolower(trim($n))] = trim($v);
                }
                return strlen($line);
            },
        ] + GitHubClientService::httpsOnlyCurlOptions());
        $handle['ch'] = $ch;
        return $handle;
    }

    /**
     * @param array<string, string> $h
     * @return array<string, mixed>
     * @throws GitHubApiException
     */
    private function interpret(int $status, array $h, string $body, string $curlError): array
    {
        if ($status === 0) {
            throw new GitHubApiException(0, $curlError !== '' ? $curlError : 'GitHub niet bereikbaar');
        }
        $data = json_decode($body, true);
        if ($status === 200 && is_array($data)) {
            $rl = $data['data']['rateLimit'] ?? null;
            if (is_array($rl)) {
                $this->lastRateLimit = [
                    'limit' => (int) $rl['limit'], 'remaining' => (int) $rl['remaining'],
                    'resetAt' => $rl['resetAt'] ?? null, 'cost' => (int) $rl['cost'],
                ];
                $this->costTotal += (int) $rl['cost'];
            }
            foreach ((array) ($data['errors'] ?? []) as $err) {
                $type = $err['type'] ?? '';
                if ($type === 'RATE_LIMITED') {
                    throw new GitHubApiException(403, (string) ($err['message'] ?? ''), $this->lastRateLimit, true);
                }
                // Collaborators zonder rechten: gedeeltelijke fout, de rest van de data is bruikbaar
                if (self::isCollaboratorError($err)) {
                    continue;
                }
                $status = $type === 'NOT_FOUND' ? 404 : 502;
                throw new GitHubApiException($status, (string) ($err['message'] ?? ''));
            }
            if (($data['data']['repository'] ?? null) === null) {
                throw new GitHubApiException(404, 'Repository niet gevonden');
            }
            return $data;
        }
        $limited = $status === 429 || ($status === 403 && (isset($h['retry-after']) || ($h['x-ratelimit-remaining'] ?? '1') === '0'));
        $message = is_array($data) && is_string($data['message'] ?? null) ? $data['message'] : '';
        throw new GitHubApiException($status, $message, null, $limited);
    }

    /** @param array<string, mixed> $err */
    private static function isCollaboratorError(array $err): bool
    {
        $path = $err['path'] ?? [];
        return is_array($path) && ($path[0] ?? null) === 'repository' && ($path[1] ?? null) === 'collaborators';
    }

    /** @param array<string, mixed> $response */
    private static function collaboratorsDenied(array $response): bool
    {
        return ($response['data']['repository']['collaborators'] ?? null) === null;
    }

    /* ===== Parsen (puur) ===== */

    /**
     * @param array<string, mixed> $repo de repository-node uit de GraphQL-respons
     * @return array{
     *   commits: list<array<string, mixed>>, prs: list<array<string, mixed>>, issues: list<array<string, mixed>>,
     *   collaborators: list<array{login: string, avatar: ?string}>, pushedAt: ?string, branchCount: int,
     *   pageInfo: array{commits: array<string, mixed>, prs: array<string, mixed>, issues: array<string, mixed>}
     * }
     */
    public static function parseRepository(array $repo, string $teacher): array
    {
        $none = ['hasNextPage' => false, 'endCursor' => null];
        $page = static fn (mixed $p): array => is_array($p)
            ? ['hasNextPage' => (bool) ($p['hasNextPage'] ?? false), 'endCursor' => $p['endCursor'] ?? null]
            : $none;
        $str = static fn (mixed $v, int $max): string => mb_substr((string) $v, 0, $max);
        $login = static fn (string $v): string => mb_substr(GitHubIdentifier::normalize($v), 0, 191);
        $actor = static function (mixed $a) use ($login): array {
            $a = is_array($a) ? $a : [];
            $name = (string) ($a['login'] ?? '');
            if ($name === '') {
                return ['', null];
            }
            if (($a['__typename'] ?? '') === 'Bot' && !str_ends_with(strtolower($name), '[bot]')) {
                $name .= '[bot]';
            }
            return [$login($name), $a['avatarUrl'] ?? null];
        };

        // Lege repository: defaultBranchRef (of target/history) is null
        $history = $repo['defaultBranchRef']['target']['history'] ?? null;
        $commits = [];
        foreach (is_array($history) ? ($history['nodes'] ?? []) : [] as $n) {
            if (!is_array($n) || empty($n['oid'])) {
                continue;
            }
            $a = is_array($n['author'] ?? null) ? $n['author'] : [];
            $user = is_array($a['user'] ?? null) ? $a['user'] : null;
            if ($user !== null && !empty($user['login'])) {
                $ident = $login((string) $user['login']);
                $avatar = $user['avatarUrl'] ?? ($a['avatarUrl'] ?? null);
            } else {
                $ident = $login((string) ($a['name'] ?? '') ?: 'onbekend');
                $avatar = null;
            }
            $commits[] = [
                'sha' => $str($n['oid'], 64), 'author' => $ident, 'avatar' => $avatar === null ? null : $str($avatar, 500),
                'headline' => $str(($n['messageHeadline'] ?? '') ?: '(Geen commit message)', 500),
                'body' => mb_substr(trim((string) ($n['messageBody'] ?? '')), 0, 2000),
                'committed_at' => self::utc((string) $n['committedDate']),
                'url' => isset($n['url']) ? $str($n['url'], 500) : null,
            ];
        }

        $prs = [];
        foreach ($repo['pullRequests']['nodes'] ?? [] as $n) {
            if (!is_array($n) || !isset($n['number'])) {
                continue;
            }
            [$ident, $avatar] = $actor($n['author'] ?? null);
            $prs[] = [
                'number' => (int) $n['number'], 'author' => $ident !== '' ? $ident : 'ghost', 'avatar' => $avatar,
                'title' => $str($n['title'] ?? '', 500),
                'state' => in_array($n['state'] ?? '', ['OPEN', 'MERGED', 'CLOSED'], true) ? $n['state'] : 'CLOSED',
                'created_at' => self::utc((string) $n['createdAt']), 'updated_at' => self::utc((string) $n['updatedAt']),
                'merged_at' => empty($n['mergedAt']) ? null : self::utc((string) $n['mergedAt']),
                'head_ref' => $str($n['headRefName'] ?? '', 255), 'base_ref' => $str($n['baseRefName'] ?? '', 255),
                'url' => isset($n['url']) ? $str($n['url'], 500) : null,
            ];
        }

        $issues = [];
        foreach ($repo['issues']['nodes'] ?? [] as $n) {
            if (!is_array($n) || !isset($n['number'])) {
                continue;
            }
            [$ident, $avatar] = $actor($n['author'] ?? null);
            $assignees = [];
            foreach ($n['assignees']['nodes'] ?? [] as $a) {
                if (is_array($a) && !empty($a['login'])) {
                    $assignees[] = $login((string) $a['login']);
                }
            }
            $labels = [];
            foreach ($n['labels']['nodes'] ?? [] as $l) {
                if (is_array($l) && isset($l['name'])) {
                    $labels[] = ['name' => $str($l['name'], 100), 'color' => $str($l['color'] ?? '', 6)];
                }
            }
            $issues[] = [
                'number' => (int) $n['number'], 'author' => $ident !== '' ? $ident : 'ghost', 'avatar' => $avatar,
                'assignees' => array_values(array_unique($assignees)), 'labels' => $labels,
                'title' => $str($n['title'] ?? '', 500),
                'state' => ($n['state'] ?? '') === 'OPEN' ? 'OPEN' : 'CLOSED',
                'created_at' => self::utc((string) $n['createdAt']), 'updated_at' => self::utc((string) $n['updatedAt']),
                'closed_at' => empty($n['closedAt']) ? null : self::utc((string) $n['closedAt']),
                'url' => isset($n['url']) ? $str($n['url'], 500) : null,
            ];
        }

        $collaborators = [];
        foreach ($repo['collaborators']['nodes'] ?? [] as $c) {
            if (is_array($c) && !empty($c['login'])) {
                $collaborators[] = ['login' => $login((string) $c['login']), 'avatar' => $c['avatarUrl'] ?? null];
            }
        }

        return [
            'commits' => $commits, 'prs' => $prs, 'issues' => $issues, 'collaborators' => $collaborators,
            'pushedAt' => empty($repo['pushedAt']) ? null : self::utc((string) $repo['pushedAt']),
            'branchCount' => (int) ($repo['refs']['totalCount'] ?? 0),
            'pageInfo' => [
                'commits' => $page(is_array($history) ? ($history['pageInfo'] ?? null) : null),
                'prs' => $page($repo['pullRequests']['pageInfo'] ?? null),
                'issues' => $page($repo['issues']['pageInfo'] ?? null),
            ],
        ];
    }

    /** ISO-8601 → 'Y-m-d H:i:s' (UTC) */
    private static function utc(string $iso): string
    {
        return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    /* ===== Opslaan ===== */

    /** @param array<string, mixed> $p */
    private function store(int $teamId, array $p, bool $collabsRequested, bool $collabsDenied, int $cost): void
    {
        $pdo = ($this->db)();
        $pdo->beginTransaction();
        try {
            $this->upsert($pdo, 'repo_commits',
                ['team_id', 'sha', 'author_identifier', 'author_avatar', 'message_headline', 'message_body', 'committed_at', 'commit_url'],
                ['author_identifier', 'author_avatar', 'message_headline', 'message_body', 'committed_at', 'commit_url'],
                array_map(static fn ($c) => [$teamId, $c['sha'], $c['author'], $c['avatar'], $c['headline'], $c['body'], $c['committed_at'], $c['url']], $p['commits']));
            $this->upsert($pdo, 'repo_pull_requests',
                ['team_id', 'pr_number', 'author_identifier', 'author_avatar', 'title', 'state', 'created_at', 'updated_at', 'merged_at', 'head_ref', 'base_ref', 'pr_url'],
                ['author_identifier', 'author_avatar', 'title', 'state', 'created_at', 'updated_at', 'merged_at', 'head_ref', 'base_ref', 'pr_url'],
                array_map(static fn ($r) => [$teamId, $r['number'], $r['author'], $r['avatar'], $r['title'], $r['state'], $r['created_at'], $r['updated_at'], $r['merged_at'], $r['head_ref'], $r['base_ref'], $r['url']], $p['prs']));
            $this->upsert($pdo, 'repo_issues',
                ['team_id', 'issue_number', 'author_identifier', 'author_avatar', 'assignees_json', 'labels_json', 'title', 'state', 'created_at', 'updated_at', 'closed_at', 'issue_url'],
                ['author_identifier', 'author_avatar', 'assignees_json', 'labels_json', 'title', 'state', 'created_at', 'updated_at', 'closed_at', 'issue_url'],
                array_map(static fn ($i) => [
                    $teamId, $i['number'], $i['author'], $i['avatar'],
                    json_encode($i['assignees'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    json_encode($i['labels'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    $i['title'], $i['state'], $i['created_at'], $i['updated_at'], $i['closed_at'], $i['url'],
                ], $p['issues']));

            $detected = null;
            if ($collabsRequested) {
                $detected = $collabsDenied ? 0 : 1;
                if (!$collabsDenied) {
                    $pdo->prepare('DELETE FROM repo_collaborators WHERE team_id = :t')->execute(['t' => $teamId]);
                    $this->upsert($pdo, 'repo_collaborators', ['team_id', 'login', 'avatar_url'], ['avatar_url'],
                        array_map(static fn ($c) => [$teamId, $c['login'], $c['avatar']], $p['collaborators']));
                }
            }

            $params = ['pushed' => $p['pushedAt'], 'b' => $p['branchCount'], 'cost' => $cost, 'id' => $teamId];
            $sql = 'UPDATE teams SET last_synced_at = UTC_TIMESTAMP(), last_repo_pushed_at = :pushed, branch_count = :b, last_sync_cost = :cost';
            if ($collabsRequested) {
                $sql .= ', collaborators_synced_at = UTC_TIMESTAMP(), collaborators_detected = :det';
                $params['det'] = $detected;
            }
            $pdo->prepare($sql . ' WHERE id = :id')->execute($params);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Multi-row INSERT … ON DUPLICATE KEY UPDATE in blokken van 100.
     *
     * @param list<string> $columns
     * @param list<string> $updates
     * @param list<list<mixed>> $rows
     */
    private function upsert(PDO $pdo, string $table, array $columns, array $updates, array $rows): void
    {
        $one = '(' . implode(',', array_fill(0, count($columns), '?')) . ')';
        $set = implode(', ', array_map(static fn ($c) => "{$c} = VALUES({$c})", $updates));
        foreach (array_chunk($rows, 100) as $chunk) {
            $pdo->prepare(
                "INSERT INTO {$table} (" . implode(',', $columns) . ') VALUES ' . implode(',', array_fill(0, count($chunk), $one))
                . " ON DUPLICATE KEY UPDATE {$set}"
            )->execute(array_merge(...$chunk));
        }
    }
}
