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

-- Stap 5: GraphQL-sync, relationele opslag en periode-filtering (zelfde inhoud als migration_step5.sql)

ALTER TABLE academic_contexts
  ADD COLUMN IF NOT EXISTS sprint_start_date DATE NULL AFTER cache_ttl_minutes;

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS last_synced_at          DATETIME NULL,
  ADD COLUMN IF NOT EXISTS last_repo_pushed_at     DATETIME NULL,
  ADD COLUMN IF NOT EXISTS collaborators_synced_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS collaborators_detected  TINYINT(1) NULL,
  ADD COLUMN IF NOT EXISTS branch_count            INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sync_cost          SMALLINT NULL;

CREATE TABLE IF NOT EXISTS repo_commits (
  team_id           INT UNSIGNED NOT NULL,
  sha               VARCHAR(64)  NOT NULL,
  author_identifier VARCHAR(191) NOT NULL,            -- lowercase login of Git-auteurnaam
  author_avatar     VARCHAR(500) NULL,
  message_headline  VARCHAR(500) NOT NULL,
  message_body      TEXT NULL,
  committed_at      DATETIME NOT NULL,
  commit_url        VARCHAR(500) NULL,
  PRIMARY KEY (team_id, sha),
  KEY idx_rc_time (team_id, committed_at),
  KEY idx_rc_author (team_id, author_identifier),
  CONSTRAINT fk_rc_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_pull_requests (
  team_id           INT UNSIGNED NOT NULL,
  pr_number         INT NOT NULL,
  author_identifier VARCHAR(191) NOT NULL,
  author_avatar     VARCHAR(500) NULL,
  title             VARCHAR(500) NOT NULL,
  state             VARCHAR(32)  NOT NULL,            -- OPEN | MERGED | CLOSED
  created_at        DATETIME NOT NULL,
  updated_at        DATETIME NOT NULL,
  merged_at         DATETIME NULL,
  head_ref          VARCHAR(255) NULL,
  base_ref          VARCHAR(255) NULL,
  pr_url            VARCHAR(500) NULL,
  PRIMARY KEY (team_id, pr_number),
  KEY idx_rpr_updated (team_id, updated_at),
  CONSTRAINT fk_rpr_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_issues (
  team_id           INT UNSIGNED NOT NULL,
  issue_number      INT NOT NULL,
  author_identifier VARCHAR(191) NOT NULL,
  author_avatar     VARCHAR(500) NULL,
  assignees_json    JSON NOT NULL,                    -- ["login", ...] lowercase
  labels_json       JSON NOT NULL,                    -- [{"name":"bug","color":"d73a4a"}, ...]
  title             VARCHAR(500) NOT NULL,
  state             VARCHAR(32)  NOT NULL,            -- OPEN | CLOSED
  created_at        DATETIME NOT NULL,
  updated_at        DATETIME NOT NULL,
  closed_at         DATETIME NULL,
  issue_url         VARCHAR(500) NULL,
  PRIMARY KEY (team_id, issue_number),
  KEY idx_ri_state (team_id, state),
  CONSTRAINT fk_ri_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Collaborators worden max. 1x per 24 uur opgehaald en moeten daartussen ergens staan
CREATE TABLE IF NOT EXISTS repo_collaborators (
  team_id    INT UNSIGNED NOT NULL,
  login      VARCHAR(191) NOT NULL,                   -- lowercase
  avatar_url VARCHAR(500) NULL,
  PRIMARY KEY (team_id, login),
  CONSTRAINT fk_rcol_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- GitHub-accounts die nooit als student meetellen (docenten, tweede accounts); globaal
CREATE TABLE IF NOT EXISTS excluded_github_accounts (
  identifier VARCHAR(191) NOT NULL,                   -- lowercase, zonder @
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (identifier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bezoek-wachtrij en logboek (Stap 6), nog zonder docent-identificatie
CREATE TABLE IF NOT EXISTS coaching_logs (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  context_id     INT UNSIGNED NOT NULL,
  team_id        INT UNSIGNED NULL,
  student_id     INT UNSIGNED NULL,
  note_text      TEXT NOT NULL,
  follow_up_date DATE NULL,
  is_resolved    TINYINT(1) NOT NULL DEFAULT 0,
  visited_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cl_context (context_id, is_resolved),
  KEY idx_cl_team (team_id),
  KEY idx_cl_student (student_id),
  CONSTRAINT fk_cl_context FOREIGN KEY (context_id) REFERENCES academic_contexts (id) ON DELETE CASCADE,
  CONSTRAINT fk_cl_team    FOREIGN KEY (team_id)    REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_cl_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eerste docent aanmaken (hash genereren met: php bin/hash-password.php)
-- INSERT INTO users (email, display_name, password_hash)
-- VALUES ('docent@example.nl', 'Docent', '<hash hier>');
