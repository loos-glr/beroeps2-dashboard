<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Http\HttpException;
use App\Http\JsonResponse;
use App\Http\Request;
use App\Http\Validate;
use App\Services\ContextService;
use App\Services\Dates;
use App\Services\MigrationService;
use App\Services\TeamAnalyticsService;

final class ContextController
{
    public function __construct(
        private readonly ContextService $contexts,
        private readonly TeamAnalyticsService $analytics,
        private readonly MigrationService $migration,
    ) {
    }

    /** @return array<string, mixed> */
    public function index(): array
    {
        return ['contexts' => $this->contexts->list()];
    }

    public function store(Request $request): never
    {
        $cols = $this->columns($request->json(), true);
        JsonResponse::send(['context' => $this->contexts->create($cols)], 201);
    }

    /** @return array<string, mixed> */
    public function update(Request $request): array
    {
        $id = $request->intParam('id');
        return ['context' => $this->contexts->update($id, $this->columns($request->json(), false))];
    }

    /** @return array<string, mixed> */
    public function dashboard(Request $request): array
    {
        $force = $request->query['force'] ?? '0';
        if ($force !== '0' && $force !== '1') {
            throw new HttpException(422, "Parameter 'force' moet 0 of 1 zijn");
        }
        // Standaard alleen uit de database lezen; de frontend synct teams daarna één voor één op de achtergrond
        $sync = $request->query['sync'] ?? ($force === '1' ? '1' : '0');
        if ($sync !== '0' && $sync !== '1') {
            throw new HttpException(422, "Parameter 'sync' moet 0 of 1 zijn");
        }
        if ($force === '1' && $sync === '0') {
            throw new HttpException(422, "Parameters 'force=1' en 'sync=0' sluiten elkaar uit");
        }
        return $this->analytics->getContextDashboardData(
            $request->intParam('id'), $force === '1', $this->period($request), $sync === '1'
        );
    }

    private function period(Request $request): string
    {
        $period = $request->query['period'] ?? 'all';
        if (!is_string($period) || !in_array($period, Dates::PERIODS, true)) {
            throw new HttpException(422, "Parameter 'period' moet all, sprint, 7days of today zijn");
        }
        return $period;
    }

    /** @return array<string, mixed> */
    public function importJson(Request $request): array
    {
        $dryRun = $request->query['dryRun'] ?? '0';
        if ($dryRun !== '0' && $dryRun !== '1') {
            throw new HttpException(422, "Parameter 'dryRun' moet 0 of 1 zijn");
        }
        if ($request->bodyBytes() > MigrationService::MAX_BODY_BYTES) {
            throw new HttpException(413, 'Importbestand is te groot (max 1 MiB)');
        }
        $plan = MigrationService::parse($request->json());
        return $this->migration->import($request->intParam('id'), $plan, $dryRun === '1');
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, scalar|null> kolomnaam => waarde
     */
    private function columns(array $body, bool $required): array
    {
        $cols = [];

        $year = Validate::string($body, 'schoolYear', 9, 9, $required);
        if ($year !== null) {
            if (preg_match('/^(\d{4})-(\d{4})$/', $year, $m) !== 1 || (int) $m[2] !== (int) $m[1] + 1) {
                throw new HttpException(422, "Veld 'schoolYear' moet de vorm 2026-2027 hebben");
            }
            $cols['school_year'] = $year;
        }
        $course = Validate::string($body, 'courseCode', 1, 32, $required);
        if ($course !== null) {
            $course = mb_strtoupper($course);
            if (preg_match('/^[A-Z0-9_-]{1,32}$/', $course) !== 1) {
                throw new HttpException(422, "Veld 'courseCode' mag alleen letters, cijfers, - en _ bevatten");
            }
            $cols['course_code'] = $course;
        }
        $class = Validate::string($body, 'className', 1, 16, $required);
        if ($class !== null) {
            $cols['class_name'] = mb_strtoupper($class);
        }
        $threshold = Validate::int($body, 'inactivityThresholdDays', 1, 365);
        if ($threshold !== null) {
            $cols['inactivity_threshold_days'] = $threshold;
        }
        $ttl = Validate::int($body, 'cacheTtlMinutes', 0, 1440);
        if ($ttl !== null) {
            $cols['cache_ttl_minutes'] = $ttl;
        }
        if (array_key_exists('sprintStartDate', $body)) {
            $cols['sprint_start_date'] = Validate::date($body, 'sprintStartDate');   // null = wissen
        }
        return $cols;
    }
}
