-- BEROEPS2 dashboard · MariaDB-schema (InnoDB, utf8mb4_unicode_ci)
-- Importeren in een lege database (Plesk: phpMyAdmin → Importeren). Idempotent.
-- Hiërarchie: Schooljaar → Vak → Klas (academic_contexts) → Teams → Studenten
-- Alle DATETIMEs zijn UTC.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Docenten
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  display_name  VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NULL,                -- NULL = alleen SSO
  microsoft_oid VARCHAR(64)  NULL,                -- GLR Microsoft Entra ID object id
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_microsoft_oid (microsoft_oid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Schooljaar + vak + klas, met instellingen die nu nog in de toolbar staan
CREATE TABLE IF NOT EXISTS academic_contexts (
  id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  school_year               VARCHAR(9)  NOT NULL,   -- '2026-2027'
  course_code               VARCHAR(32) NOT NULL,   -- 'BEROEPS2'
  class_name                VARCHAR(16) NOT NULL,   -- 'D2B'
  inactivity_threshold_days SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  cache_ttl_minutes         SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_context (school_year, course_code, class_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teams (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  context_id     INT UNSIGNED NOT NULL,
  team_name      VARCHAR(255) NOT NULL,
  repo_full_name VARCHAR(201) NOT NULL,             -- 'owner/repo'
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_repo (context_id, repo_full_name),
  CONSTRAINT fk_teams_context FOREIGN KEY (context_id)
    REFERENCES academic_contexts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS students (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name      VARCHAR(255) NOT NULL,
  student_number VARCHAR(32)  NULL,
  class_name     VARCHAR(16)  NULL,                 -- optioneel; actuele klas volgt uit academic_contexts
  notes          TEXT NULL,                         -- formatieve docent-aantekeningen
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_students_number (student_number),
  KEY idx_students_class (class_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Meerdere GitHub-accounts / Git-auteurnamen per student (ontdubbelen over projecten heen).
-- Identifiers zijn altijd lowercase; de CHECK gebruikt _bin omdat = onder _ci niet hoofdlettergevoelig is.
CREATE TABLE IF NOT EXISTS student_github_accounts (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id        INT UNSIGNED NOT NULL,
  github_identifier VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_github_identifier (github_identifier),
  KEY idx_sga_student (student_id),
  CONSTRAINT fk_sga_student FOREIGN KEY (student_id)
    REFERENCES students (id) ON DELETE CASCADE,
  CONSTRAINT chk_sga_lowercase CHECK (github_identifier COLLATE utf8mb4_bin = LOWER(github_identifier))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verwachte teamleden, zodat studenten met 0 commits ook bij het team horen
CREATE TABLE IF NOT EXISTS team_expected_members (
  team_id           INT UNSIGNED NOT NULL,
  github_identifier VARCHAR(255) NOT NULL,
  PRIMARY KEY (team_id, github_identifier),
  KEY idx_tem_identifier (github_identifier),
  CONSTRAINT fk_tem_team FOREIGN KEY (team_id)
    REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT chk_tem_lowercase CHECK (github_identifier COLLATE utf8mb4_bin = LOWER(github_identifier))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side ETag-cache (304's tellen niet mee voor de GitHub rate limit)
CREATE TABLE IF NOT EXISTS github_http_cache (
  cache_key     CHAR(64)      NOT NULL,             -- SHA256 van api_url
  api_url       VARCHAR(2048) NOT NULL,
  etag          VARCHAR(255)  NULL,
  response_json LONGTEXT      NOT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cache_key),
  KEY idx_ghc_updated (updated_at),
  CONSTRAINT chk_ghc_json CHECK (JSON_VALID(response_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Geparseerde teamdata met TTL (zie academic_contexts.cache_ttl_minutes)
CREATE TABLE IF NOT EXISTS team_snapshots (
  team_id      INT UNSIGNED NOT NULL,
  payload_json LONGTEXT NOT NULL,
  fetched_at   DATETIME NOT NULL,
  PRIMARY KEY (team_id),
  CONSTRAINT fk_ts_team FOREIGN KEY (team_id)
    REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT chk_ts_json CHECK (JSON_VALID(payload_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eerste docent aanmaken (hash genereren met: php bin/hash-password.php)
-- INSERT INTO users (email, display_name, password_hash)
-- VALUES ('docent@example.nl', 'Docent', '<hash hier>');
