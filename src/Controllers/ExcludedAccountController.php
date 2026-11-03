<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\HttpException;
use App\Http\Request;
use App\Http\Validate;
use App\Services\ExcludedAccountService;
use App\Services\GitHubIdentifier;

final class ExcludedAccountController
{
    public function __construct(private readonly ExcludedAccountService $excluded)
    {
    }

    /** @return array<string, mixed> */
    public function index(): array
    {
        return ['accounts' => $this->excluded->list()];
    }

    /** @return array<string, mixed> */
    public function update(Request $request): array
    {
        $list = Validate::list($request->json(), 'identifiers', 50);
        if ($list === null) {
            throw new HttpException(422, "Veld 'identifiers' is verplicht");
        }
        $ids = GitHubIdentifier::normalizeList($list);
        foreach ($ids as $id) {
            if (mb_strlen($id) > 191) {
                throw new HttpException(422, 'Een accountnaam is te lang (max 191 tekens)');
            }
        }
        return ['accounts' => $this->excluded->replace($ids)];
    }
}
