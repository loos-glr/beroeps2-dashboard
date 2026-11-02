<?php

declare(strict_types=1);

namespace App\Services;

use App\Config\Config;
use Closure;
use CurlHandle;
use InvalidArgumentException;
use JsonException;
use PDO;

/**
 * GitHub REST-client met conditionele requests (Laag 2): per URL worden ETag + body in
 * `github_http_cache` bewaard en als `If-None-Match` meegestuurd. Een 304 telt niet mee voor
 * de GitHub rate limit.
 */
final class GitHubClientService
{
    public const API = 'https://api.github.com';
    private const USER_AGENT = 'GLR-Beroeps2-Dashboard/1.0';
    private const MAX_PARALLEL = 6;

    /** @var array<string, mixed>|null */
    private ?array $lastRateLimit = null;

    /** @param Closure(): PDO $db */
    public function __construct(
        private readonly Closure $db,
        private readonly Config $config,
        private readonly ?string $headerToken = null,
    ) {
    }

    /* ===== Token ===== */

    /** Het .env-token wint; de X-GitHub-Token header geldt alleen als .env leeg is en het formaat klopt. */
    public function token(): string
    {
        if ($this->config->githubToken !== '') {
            return $this->config->githubToken;
        }
        $header = trim((string) $this->headerToken);
        return preg_match('/^[A-Za-z0-9_]{20,255}$/', $header) === 1 ? $header : '';
    }

    /** @return 'env'|'header'|'anonymous' */
    public function authMode(): string
    {
        if ($this->config->githubToken !== '') {
            return 'env';
        }
        return $this->token() !== '' ? 'header' : 'anonymous';
    }

    /** @return array<string, mixed>|null laatst geziene x-ratelimit-* waarden */
    public function lastRateLimit(): ?array
    {
        return $this->lastRateLimit;
    }

    /* ===== URL's ===== */

    public static function repoUrl(string $repoFullName, string $pathAndQuery): string
    {
        [$owner, $repo] = explode('/', $repoFullName, 2) + [1 => ''];
        return self::API . '/repos/' . rawurlencode($owner) . '/' . rawurlencode($repo) . '/' . ltrim($pathAndQuery, '/');
    }

    private function assertUrl(string $url): void
    {
        // Voorkomt dat het token naar een andere host gestuurd wordt
        if (!str_starts_with($url, self::API . '/')) {
            throw new InvalidArgumentException('Alleen api.github.com is toegestaan');
        }
    }

    /** /user/* is token-afhankelijk, dus daar hoort het token bij de cache-sleutel. */
    private function cacheKey(string $url): string
    {
        if (str_starts_with($url, self::API . '/user/')) {
            return hash('sha256', $url . "\n" . hash('sha256', $this->token()));
        }
        return hash('sha256', $url);
    }

    /* ===== Publieke API ===== */

    /**
     * @return array{status: int, data: mixed, notModified: bool, stale: bool, truncated: bool, rateLimit: ?array<string, mixed>}
     * @throws GitHubApiException
     */
    public function fetchWithConditionalCache(string $url, bool $bypassCache = false): array
    {
        $this->assertUrl($url);
        $key = $this->cacheKey($url);
        $cached = $this->lookup($key);
        $etag = (!$bypassCache && $cached !== null) ? $cached['etag'] : null;

        $sink = [];
        $ch = $this->newHandle($url, $etag, $sink);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = $body === false ? curl_error($ch) : '';

        return $this->interpret($url, $key, $cached, $status, $sink, $body === false ? '' : (string) $body, $err);
    }

    /**
     * Parallelle variant (curl_multi, max 6 tegelijk). Fouten gelden per URL.
     *
     * @param array<string, string> $urls sleutel => url
     * @return array<string, array<string, mixed>|GitHubApiException>
     */
    public function fetchAll(array $urls, bool $bypassCache = false): array
    {
        $out = [];
        $prepared = [];
        $sinks = [];
        foreach ($urls as $k => $url) {
            $this->assertUrl($url);
            $key = $this->cacheKey($url);
            $cached = $this->lookup($key);
            $sinks[$k] = [];
            $prepared[$k] = [
                'url' => $url,
                'key' => $key,
                'cached' => $cached,
                'ch' => $this->newHandle($url, (!$bypassCache && $cached !== null) ? $cached['etag'] : null, $sinks[$k]),
            ];
        }

        $mh = curl_multi_init();
        $queue = array_keys($prepared);
        $active = [];
        $byId = [];

        while ($queue !== [] || $active !== []) {
            while ($queue !== [] && count($active) < self::MAX_PARALLEL) {
                $k = array_shift($queue);
                curl_multi_add_handle($mh, $prepared[$k]['ch']);
                $active[$k] = true;
                $byId[spl_object_id($prepared[$k]['ch'])] = $k;
            }

            do {
                $code = curl_multi_exec($mh, $running);
            } while ($code === CURLM_CALL_MULTI_PERFORM);

            while (($info = curl_multi_info_read($mh)) !== false) {
                $k = $byId[spl_object_id($info['handle'])];
                $p = $prepared[$k];
                $ok = $info['result'] === CURLE_OK;
                $status = $ok ? (int) curl_getinfo($p['ch'], CURLINFO_RESPONSE_CODE) : 0;
                $body = $ok ? (string) curl_multi_getcontent($p['ch']) : '';
                $err = $ok ? '' : curl_error($p['ch']);
                curl_multi_remove_handle($mh, $p['ch']);
                unset($active[$k]);

                try {
                    $out[$k] = $this->interpret($p['url'], $p['key'], $p['cached'], $status, $sinks[$k], $body, $err);
                } catch (GitHubApiException $e) {
                    $out[$k] = $e;
                }
            }

            if ($active !== [] && curl_multi_select($mh, 1.0) === -1) {
                usleep(1000);
            }
        }
        curl_multi_close($mh);

        return $out;
    }

    /**
     * Rate limit via /rate_limit (telt zelf niet mee voor de limiet, dus bewust zonder cache).
     *
     * @return array{authMode: string, core: array<string, mixed>, graphql: ?array<string, mixed>}
     * @throws GitHubApiException
     */
    public function getRateLimit(): array
    {
        $sink = [];
        $ch = $this->newHandle(self::API . '/rate_limit', null, $sink);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($body === false) {
            throw new GitHubApiException(0, curl_error($ch));
        }
        if ($status !== 200) {
            throw $this->errorFor($status, $sink, (string) $body);
        }

        $resources = json_decode((string) $body, true)['resources'] ?? [];
        $core = $resources['core'] ?? null;
        if (!is_array($core)) {
            throw new GitHubApiException(502, 'Onverwachte rate-limit respons');
        }
        $rate = [
            'limit' => (int) $core['limit'],
            'remaining' => (int) $core['remaining'],
            'used' => (int) ($core['used'] ?? 0),
            'resetAt' => gmdate('Y-m-d\TH:i:s\Z', (int) $core['reset']),
        ];
        $this->lastRateLimit = $rate;

        $gql = $resources['graphql'] ?? null;
        $graphql = !is_array($gql) ? null : [
            'limit' => (int) $gql['limit'],
            'remaining' => (int) $gql['remaining'],
            'resetAt' => gmdate('Y-m-d\TH:i:s\Z', (int) $gql['reset']),
        ];

        return ['authMode' => $this->authMode(), 'core' => $rate, 'graphql' => $graphql];
    }

    /**
     * Repo's waar het token collaborator op is.
     *
     * @return list<array<string, mixed>>
     * @throws GitHubApiException
     */
    public function getCollaboratorRepos(): array
    {
        if ($this->token() === '') {
            throw new GitHubApiException(401, 'Geen GitHub-token ingesteld');
        }
        $res = $this->fetchWithConditionalCache(self::API . '/user/repos?affiliation=collaborator&per_page=100&sort=updated');

        $repos = [];
        foreach (is_array($res['data']) ? $res['data'] : [] as $r) {
            if (!is_array($r) || !isset($r['full_name'])) {
                continue;
            }
            $repos[] = [
                'name' => (string) ($r['name'] ?? ''),
                'fullName' => (string) $r['full_name'],
                'private' => (bool) ($r['private'] ?? false),
                'htmlUrl' => (string) ($r['html_url'] ?? ''),
                'updatedAt' => $r['updated_at'] ?? null,
            ];
        }
        return $repos;
    }

    /** Ruimt cache-rijen van een repo op (bijv. na het verwijderen van een team). */
    public function forgetRepo(string $repoFullName): void
    {
        $prefix = self::repoUrl($repoFullName, '');
        // '|' als escape-teken, zodat % en _ in de repo-naam letterlijk worden vergeleken
        $like = str_replace(['|', '%', '_'], ['||', '|%', '|_'], $prefix) . '%';
        ($this->db)()
            ->prepare("DELETE FROM github_http_cache WHERE api_url LIKE :p ESCAPE '|'")
            ->execute(['p' => $like]);
    }

    /* ===== Intern ===== */

    /** @return array{etag: ?string, response_json: string}|null */
    private function lookup(string $key): ?array
    {
        $stmt = ($this->db)()->prepare('SELECT etag, response_json FROM github_http_cache WHERE cache_key = :k');
        $stmt->execute(['k' => $key]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string, string> $sink ontvangt de response-headers (lowercase namen) */
    private function newHandle(string $url, ?string $etag, array &$sink): CurlHandle
    {
        $headers = [
            'User-Agent: ' . self::USER_AGENT,
            'Accept: application/vnd.github+json',
            'X-GitHub-Api-Version: 2022-11-28',
        ];
        $token = $this->token();
        if ($token !== '') {
            $headers[] = 'Authorization: Bearer ' . $token;
        }
        if ($etag !== null && $etag !== '') {
            $headers[] = 'If-None-Match: ' . $etag;
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_ENCODING => '',
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_PROTOCOLS_STR => 'https',
            CURLOPT_REDIR_PROTOCOLS_STR => 'https',
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$sink): int {
                if (preg_match('#^HTTP/\S+\s+\d{3}#', $line) === 1) {
                    $sink = [];                         // nieuwe response (redirect)
                } elseif (str_contains($line, ':')) {
                    [$name, $value] = explode(':', $line, 2);
                    $sink[strtolower(trim($name))] = trim($value);
                }
                return strlen($line);
            },
        ]);
        return $ch;
    }

    /** @param array<string, string> $h */
    private function rateFrom(array $h): ?array
    {
        if (!isset($h['x-ratelimit-remaining'], $h['x-ratelimit-limit'])) {
            return null;
        }
        $rate = [
            'limit' => (int) $h['x-ratelimit-limit'],
            'remaining' => (int) $h['x-ratelimit-remaining'],
            'used' => (int) ($h['x-ratelimit-used'] ?? ((int) $h['x-ratelimit-limit'] - (int) $h['x-ratelimit-remaining'])),
            'resetAt' => isset($h['x-ratelimit-reset']) ? gmdate('Y-m-d\TH:i:s\Z', (int) $h['x-ratelimit-reset']) : null,
        ];
        return $rate;
    }

    /** @param array<string, string> $h */
    private function errorFor(int $status, array $h, string $body): GitHubApiException
    {
        $rate = $this->rateFrom($h);
        $message = '';
        $decoded = json_decode($body, true);
        if (is_array($decoded) && isset($decoded['message']) && is_string($decoded['message'])) {
            $message = $decoded['message'];
        }
        $limited = $status === 429
            || ($status === 403 && (($rate['remaining'] ?? 1) === 0 || isset($h['retry-after'])));

        return new GitHubApiException($status, $message, $rate, $limited);
    }

    /**
     * Zet een ruwe response om naar een resultaat of exception, en onderhoudt de cache-rij.
     *
     * @param array{etag: ?string, response_json: string}|null $cached
     * @param array<string, string> $h
     * @return array{status: int, data: mixed, notModified: bool, stale: bool, truncated: bool, rateLimit: ?array<string, mixed>}
     */
    private function interpret(string $url, string $key, ?array $cached, int $status, array $h, string $body, string $curlError): array
    {
        $rate = $this->rateFrom($h);
        if ($rate !== null) {
            $this->lastRateLimit = $rate;
        }
        $truncated = isset($h['link']) && str_contains($h['link'], 'rel="next"');
        $result = static fn (int $s, mixed $data, bool $nm = false, bool $stale = false): array => [
            'status' => $s, 'data' => $data, 'notModified' => $nm, 'stale' => $stale,
            'truncated' => $truncated, 'rateLimit' => $rate,
        ];

        if ($status === 304 && $cached !== null) {
            ($this->db)()
                ->prepare('UPDATE github_http_cache SET updated_at = UTC_TIMESTAMP(), etag = COALESCE(:e, etag) WHERE cache_key = :k')
                ->execute(['e' => $h['etag'] ?? null, 'k' => $key]);
            return $result(304, json_decode($cached['response_json'], true), true);
        }

        if ($status >= 200 && $status < 300) {
            try {
                $data = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                throw new GitHubApiException(502, 'Ongeldige JSON van GitHub');
            }
            ($this->db)()->prepare(
                'INSERT INTO github_http_cache (cache_key, api_url, etag, response_json, updated_at)
                 VALUES (:k, :u, :e, :j, UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE api_url = VALUES(api_url), etag = VALUES(etag),
                   response_json = VALUES(response_json), updated_at = VALUES(updated_at)'
            )->execute(['k' => $key, 'u' => $url, 'e' => $h['etag'] ?? null, 'j' => $body]);
            return $result(200, $data);
        }

        // Netwerkfout of 5xx: een oudere cachebody is beter dan niets
        if (($status === 0 || $status >= 500) && $cached !== null) {
            return $result(200, json_decode($cached['response_json'], true), false, true);
        }
        if ($status === 0) {
            throw new GitHubApiException(0, $curlError !== '' ? $curlError : 'GitHub niet bereikbaar');
        }

        throw $this->errorFor($status, $h, $body);
    }
}
