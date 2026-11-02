<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\HttpException;
use App\Http\JsonResponse;
use App\Http\Request;
use App\Http\Validate;
use App\Services\GitHubIdentifier;
use App\Services\TeamAnalyticsService;
use App\Services\TeamService;

final class TeamController
{
    public function __construct(
        private readonly TeamService $teams,
        private readonly TeamAnalyticsService $analytics,
    ) {
    }

    public function store(Request $request): never
    {
        $body = $request->json();
        $contextId = Validate::int($body, 'contextId', 1, 4294967295, true);
        $name = Validate::string($body, 'teamName', 1, 255);
        $repo = $this->repo($body, true);
        $expected = $this->expected($body) ?? [];

        JsonResponse::send(['team' => $this->teams->create($contextId, $name, $repo, $expected)], 201);
    }

    /** @return array<string, mixed> */
    public function update(Request $request): array
    {
        $body = $request->json();
        $fields = array_filter([
            'teamName' => Validate::string($body, 'teamName', 1, 255, false),
            'repoFullName' => $this->repo($body, false),
            'expectedMembers' => $this->expected($body),
        ], static fn ($v) => $v !== null);

        return ['team' => $this->teams->update($request->intParam('id'), $fields)];
    }

    /** @return array<string, mixed> */
    public function destroy(Request $request): array
    {
        $id = $request->intParam('id');
        $this->teams->delete($id);
        return ['ok' => true, 'deletedTeamId' => $id];
    }

    /** @return array<string, mixed> */
    public function refresh(Request $request): array
    {
        return $this->analytics->getTeamDashboardData($request->intParam('id'), true);
    }

    /** @param array<string, mixed> $body */
    private function repo(array $body, bool $required): ?string
    {
        $raw = Validate::string($body, 'repoFullName', 3, 300, $required);
        if ($raw === null) {
            return null;
        }
        $repo = GitHubIdentifier::normalizeRepo($raw);
        if ($repo === null) {
            throw new HttpException(422, "Veld 'repoFullName' moet de vorm owner/repo hebben");
        }
        return $repo;
    }

    /**
     * @param array<string, mixed> $body
     * @return list<string>|null
     */
    private function expected(array $body): ?array
    {
        $list = Validate::list($body, 'expectedMembers', 100);
        return $list === null ? null : GitHubIdentifier::normalizeList($list);
    }
}
