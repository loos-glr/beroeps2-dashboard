<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\HttpException;
use App\Http\JsonResponse;
use App\Http\Request;
use App\Http\Validate;
use App\Services\CoachingLogService;

final class CoachingLogController
{
    private const MAX_NOTE = 5000;

    public function __construct(private readonly CoachingLogService $logs)
    {
    }

    /** @return array<string, mixed> */
    public function index(Request $request): array
    {
        return ['logs' => $this->logs->list($request->intParam('id'))];
    }

    public function store(Request $request): never
    {
        $body = $request->json();
        $input = [
            'teamId' => Validate::int($body, 'teamId', 1, 4294967295),
            'studentId' => Validate::int($body, 'studentId', 1, 4294967295),
            'noteText' => $this->note($body, false),
            'followUpDate' => Validate::date($body, 'followUpDate'),
            'resolveDue' => $this->flag($body, 'resolveDue') ?? false,
        ];
        if (isset($body['githubIdentifier'])) {
            $input['githubIdentifier'] = Validate::string($body, 'githubIdentifier', 1, 255);
            $input['fullName'] = Validate::string($body, 'fullName', 1, 255, false);
        }
        JsonResponse::send($this->logs->create($request->intParam('id'), $input), 201);
    }

    /** @return array<string, mixed> */
    public function update(Request $request): array
    {
        $body = $request->json();
        $fields = [];
        $resolved = $this->flag($body, 'isResolved');
        if ($resolved !== null) {
            $fields['isResolved'] = $resolved;
        }
        if (array_key_exists('noteText', $body)) {
            $fields['noteText'] = $this->note($body, true);
        }
        if (array_key_exists('followUpDate', $body)) {
            $fields['followUpDate'] = Validate::date($body, 'followUpDate');
        }
        return $this->logs->update($request->intParam('id'), $fields);
    }

    /** @return array<string, mixed> */
    public function destroy(Request $request): array
    {
        $id = $request->intParam('id');
        return ['ok' => true, 'deletedLogId' => $id] + $this->logs->delete($id);
    }

    /** @param array<string, mixed> $body */
    private function note(array $body, bool $required): ?string
    {
        return Validate::string($body, 'noteText', $required ? 1 : 0, self::MAX_NOTE, $required);
    }

    /** @param array<string, mixed> $body */
    private function flag(array $body, string $key): ?bool
    {
        if (!array_key_exists($key, $body)) {
            return null;
        }
        $v = $body[$key];
        if ($v === true || $v === 1 || $v === '1') {
            return true;
        }
        if ($v === false || $v === 0 || $v === '0') {
            return false;
        }
        throw new HttpException(422, "Veld '{$key}' moet true/false (of 1/0) zijn");
    }
}
