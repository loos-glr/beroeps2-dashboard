<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\HttpException;
use App\Http\Request;
use App\Http\Validate;
use App\Services\GitHubClientService;
use Closure;
use PDO;

final class GitHubController
{
    /** @param Closure(): PDO $db */
    public function __construct(private readonly GitHubClientService $github, private readonly Closure $db)
    {
    }

    /** @return array<string, mixed> */
    public function rateLimit(): array
    {
        return $this->github->getRateLimit();
    }

    /** @return array<string, mixed> */
    public function collaboratorRepos(Request $request): array
    {
        $contextId = Validate::int($request->query, 'contextId', 1, 4294967295);
        $repos = $this->github->getCollaboratorRepos();

        // Welke repo's zijn in deze klas al een team?
        $teamIds = [];
        if ($contextId !== null) {
            $stmt = ($this->db)()->prepare('SELECT id, repo_full_name FROM teams WHERE context_id = :c');
            $stmt->execute(['c' => $contextId]);
            foreach ($stmt->fetchAll() as $row) {
                $teamIds[mb_strtolower($row['repo_full_name'])] = (int) $row['id'];
            }
        }
        foreach ($repos as &$repo) {
            $repo['teamId'] = $teamIds[mb_strtolower($repo['fullName'])] ?? null;
        }
        return ['repos' => $repos];
    }
}
