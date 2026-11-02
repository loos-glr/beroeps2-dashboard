-- BEROEPS2 dashboard · Stap 5: GraphQL-sync, relationele opslag en periode-filtering
-- Idempotent; draaien op een bestaande database (schema.sql bevat dezelfde eindstand).
-- Alle DATETIMEs zijn UTC.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- Vervangen door repo_*-tabellen
DROP TABLE IF EXISTS team_snapshots;
