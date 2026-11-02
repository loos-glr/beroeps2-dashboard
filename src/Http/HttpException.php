<?php

declare(strict_types=1);

namespace App\Http;

use RuntimeException;

/** Fout met een HTTP-statuscode; wordt door de API als JSON teruggegeven. */
final class HttpException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}
