<?php

declare(strict_types=1);

namespace App\Auth;

use App\Config\Config;
use App\Http\HttpException;
use App\Http\Request;
use Closure;
use PDO;

/**
 * Sessie-gebaseerde authenticatie voor docenten.
 *
 * POC: login via de `users`-tabel (password_verify) of via het gedeelde
 * docentenwachtwoord uit .env. Microsoft Entra ID SSO klikt later in via
 * handleMicrosoftCallback() zonder dat de rest van de API verandert.
 */
final class AuthService
{
    public function __construct(
        /** @var Closure(): PDO */
        private readonly Closure $db,
        private readonly Config $config,
        private readonly SessionManager $session,
    ) {
    }

    /** Argon2id indien beschikbaar, anders PASSWORD_DEFAULT. */
    public static function hashPassword(string $password): string
    {
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
        return password_hash($password, $algo);
    }

    /** @return array{user: array<string, mixed>, csrfToken: string} */
    public function attemptLogin(?string $email, string $password): array
    {
        $email = $email !== null ? strtolower(trim($email)) : '';
        $isShared = $this->config->sharedPassword !== '' && hash_equals($this->config->sharedPassword, $password);

        if ($email !== '') {
            $pdo = ($this->db)();
            $stmt = $pdo->prepare('SELECT id, email, display_name, password_hash FROM users WHERE email = :email');
            $stmt->execute(['email' => $email]);
            $row = $stmt->fetch();

            if ($row && $row['password_hash'] !== null && password_verify($password, $row['password_hash'])) {
                if (password_needs_rehash($row['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
                    $pdo->prepare('UPDATE users SET password_hash = :h WHERE id = :id')
                        ->execute(['h' => self::hashPassword($password), 'id' => $row['id']]);
                }
                $pdo->prepare('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = :id')
                    ->execute(['id' => $row['id']]);

                return $this->establishSession([
                    'id' => (int) $row['id'],
                    'email' => $row['email'],
                    'display_name' => $row['display_name'],
                ], 'password');
            }
        }

        // POC-fallback: gedeeld docentenwachtwoord uit .env
        if ($isShared) {
            return $this->establishSession(
                ['id' => null, 'email' => null, 'display_name' => 'Docent'],
                'shared'
            );
        }

        usleep(random_int(200_000, 400_000));
        throw new HttpException(401, 'Onjuiste inloggegevens');
    }

    public function isAuthenticated(): bool
    {
        $this->session->start();
        return !empty($_SESSION['user']);
    }

    /** @return array<string, mixed>|null */
    public function currentUser(): ?array
    {
        return $this->isAuthenticated() ? $_SESSION['user'] : null;
    }

    /** @return array<string, mixed> */
    public function requireAuth(): array
    {
        $user = $this->currentUser();
        if ($user === null) {
            throw new HttpException(401, 'Niet ingelogd');
        }
        return $user;
    }

    public function verifyCsrf(Request $request): void
    {
        $this->session->start();
        $sent = $request->header('X-CSRF-Token') ?? '';
        if ($sent === '' || !hash_equals($this->session->csrfToken(), $sent)) {
            throw new HttpException(403, 'Ongeldig CSRF-token');
        }
    }

    public function csrfToken(): string
    {
        $this->session->start();
        return $this->session->csrfToken();
    }

    public function logout(): void
    {
        $this->session->start();
        $this->session->destroy();
    }

    /**
     * PLACEHOLDER: GLR Microsoft Entra ID SSO.
     *
     * Toekomstige flow: state/nonce controleren → `code` inwisselen voor tokens
     * → `oid` (en email) uit het ID-token valideren → `users.microsoft_oid`
     * opzoeken of koppelen via email → $this->establishSession($user, 'microsoft').
     *
     * @param array<string, mixed> $query
     * @return array{user: array<string, mixed>, csrfToken: string}
     */
    public function handleMicrosoftCallback(array $query): array
    {
        throw new HttpException(501, 'Microsoft SSO is nog niet geconfigureerd');
    }

    /**
     * @param array<string, mixed> $user
     * @return array{user: array<string, mixed>, csrfToken: string}
     */
    private function establishSession(array $user, string $method): array
    {
        $this->session->start();
        session_regenerate_id(true);
        $user['auth_method'] = $method;
        $_SESSION['user'] = $user;
        $_SESSION['csrf'] = bin2hex(random_bytes(32));

        return ['user' => $user, 'csrfToken' => $this->session->csrfToken()];
    }
}
