<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth\AuthService;
use App\Http\HttpException;
use App\Http\Request;

final class AuthController
{
    public function __construct(private readonly AuthService $auth)
    {
    }

    /** @return array<string, mixed> */
    public function login(Request $request): array
    {
        $body = $request->json();
        $password = $body['password'] ?? null;
        $email = $body['email'] ?? null;
        if (!is_string($password) || $password === '' || ($email !== null && !is_string($email))) {
            throw new HttpException(422, 'Wachtwoord is verplicht');
        }
        return $this->auth->attemptLogin($email, $password);
    }

    /** @return array<string, mixed> */
    public function me(): array
    {
        $user = $this->auth->currentUser();
        if ($user === null) {
            return ['authenticated' => false];
        }
        return ['authenticated' => true, 'user' => $user, 'csrfToken' => $this->auth->csrfToken()];
    }

    /** @return array<string, mixed> */
    public function logout(): array
    {
        $this->auth->logout();
        return ['ok' => true];
    }

    /** @return array<string, mixed> */
    public function microsoft(Request $request): array
    {
        return $this->auth->handleMicrosoftCallback($request->query);
    }
}
