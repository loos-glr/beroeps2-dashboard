-- BEROEPS2 dashboard · uitgesloten GitHub-accounts (docenten). Idempotent.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS excluded_github_accounts (
  identifier VARCHAR(191) NOT NULL,                   -- lowercase, zonder @
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (identifier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
