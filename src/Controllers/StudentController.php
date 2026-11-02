<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\HttpException;
use App\Http\JsonResponse;
use App\Http\Request;
use App\Http\Validate;
use App\Services\GitHubIdentifier;
use App\Services\StudentIdentityService;

final class StudentController
{
    public function __construct(private readonly StudentIdentityService $students)
    {
    }

    /** @return array<string, mixed> */
    public function index(Request $request): array
    {
        $q = $request->query['q'] ?? '';
        return ['students' => $this->students->list(is_string($q) ? $q : '')];
    }

    public function identity(Request $request): never
    {
        $body = $request->json();

        $studentId = null;
        if (isset($body['studentId'])) {
            $studentId = Validate::int($body, 'studentId', 1, 4294967295, true);
        }

        $fields = [];
        $name = Validate::string($body, 'fullName', 1, 255, false);
        if ($name !== null) {
            $fields['fullName'] = $name;
        }
        foreach (['studentNumber' => 32, 'notes' => 65000] as $key => $max) {
            if (array_key_exists($key, $body)) {
                $value = $body[$key] === null ? null : Validate::string($body, $key, 0, $max);
                $fields[$key] = ($value === null || $value === '') ? null : $value;
            }
        }

        $handles = null;
        $list = Validate::list($body, 'handles', 20);
        if ($list !== null) {
            $handles = GitHubIdentifier::normalizeList($list);
            foreach ($handles as $h) {
                if (mb_strlen($h) > 255) {
                    throw new HttpException(422, 'Een handle is te lang (max 255 tekens)');
                }
            }
        }

        $result = $this->students->upsert($studentId, $fields, $handles);
        $created = $result['created'];
        unset($result['created']);
        JsonResponse::send($result, $created ? 201 : 200);
    }

    /** @return array<string, mixed> */
    public function destroy(Request $request): array
    {
        $id = $request->intParam('id');
        return ['ok' => true, 'deletedStudentId' => $id] + $this->students->delete($id);
    }
}
