import { SOCIAL_SCHEMA_VERSION } from './social-chat-schema.mjs';
import {
  LEGACY_FILE_TASK_GUIDANCE,
  FILE_TASK_GUIDANCE,
  isoNow,
} from './records.mjs';

export function migrateSocialChatSchema(db) {
  db.exec(`
      CREATE TABLE IF NOT EXISTS social_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
  const current =
    db
      .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
      .get()?.version ?? 0;
  if (current > SOCIAL_SCHEMA_VERSION) {
    throw new Error(
      `Social chat schema ${current} is newer than this Noema build supports.`,
    );
  }
  if (current < 1) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('core', 'specialist')),
            headline TEXT NOT NULL,
            description TEXT NOT NULL,
            system_prompt TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE social_rooms (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE social_room_members (
            room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE RESTRICT,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (room_id, agent_id)
          );

          CREATE TABLE social_messages (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
            turn_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            agent_id TEXT REFERENCES social_agents(id) ON DELETE SET NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'interrupted', 'failed')),
            attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
            model TEXT,
            runtime TEXT NOT NULL CHECK (runtime IN ('provider', 'freellmapi', 'local', 'system')),
            error_code TEXT,
            error_message TEXT,
            legacy_source_id TEXT UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE INDEX social_messages_room_order
            ON social_messages(room_id, seq);
          CREATE INDEX social_messages_turn_attempt
            ON social_messages(turn_id, attempt, role);

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (1, '${isoNow()}');
        `);
    })();
  }
  if (current < 2) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_agents
            ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';

          CREATE TABLE social_work_tasks (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE RESTRICT,
            workspace_path TEXT NOT NULL,
            workspace_key TEXT NOT NULL,
            task_prompt TEXT NOT NULL,
            model TEXT NOT NULL,
            runtime TEXT NOT NULL CHECK (runtime IN ('dsh')),
            runtime_session_id TEXT,
            status TEXT NOT NULL CHECK (
              status IN ('starting', 'running', 'verifying', 'completed', 'failed', 'interrupted')
            ),
            phase TEXT,
            tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
            tool_action_categories_json TEXT NOT NULL DEFAULT '[]',
            result_text TEXT NOT NULL DEFAULT '',
            error_code TEXT,
            error_message TEXT,
            verification_status TEXT NOT NULL CHECK (
              verification_status IN ('not_planned', 'pending', 'verified', 'failed', 'unavailable')
            ),
            verification_checks_json TEXT NOT NULL DEFAULT '[]',
            verification_results_json TEXT NOT NULL DEFAULT '[]',
            verification_attempts INTEGER NOT NULL DEFAULT 0 CHECK (verification_attempts >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
          );

          CREATE INDEX social_work_tasks_room_order
            ON social_work_tasks(room_id, created_at);
          CREATE INDEX social_work_tasks_active_workspace
            ON social_work_tasks(workspace_key, status);

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (2, '${isoNow()}');
        `);
      const capabilities = db.prepare(`
          UPDATE social_agents SET capabilities_json = ?
          WHERE id = ? AND capabilities_json = '[]'
        `);
      capabilities.run(JSON.stringify(['project-work']), 'engineering-partner');
    })();
  }
  if (current < 3) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_work_tasks
            ADD COLUMN case_eligible INTEGER NOT NULL DEFAULT 1
              CHECK (case_eligible IN (0, 1));
          ALTER TABLE social_work_tasks
            ADD COLUMN case_snapshot_json TEXT NOT NULL DEFAULT 'null';
          ALTER TABLE social_work_tasks
            ADD COLUMN case_reuse_requested INTEGER NOT NULL DEFAULT 0
              CHECK (case_reuse_requested IN (0, 1));

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (3, '${isoNow()}');
        `);
    })();
  }
  if (current < 4) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_agents ADD COLUMN archived_at TEXT;

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (4, '${isoNow()}');
        `);
    })();
  }
  if (current < 5) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_messages
            ADD COLUMN forwarded_sources_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE social_messages
            ADD COLUMN reply_to_message_id TEXT;
          ALTER TABLE social_messages
            ADD COLUMN reply_to_json TEXT NOT NULL DEFAULT 'null';

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (5, '${isoNow()}');
        `);
    })();
  }
  if (current < 6) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_work_tasks
            ADD COLUMN practice_candidate_status TEXT NOT NULL DEFAULT 'not_requested'
              CHECK (practice_candidate_status IN (
                'not_requested', 'none', 'pending', 'available', 'trialing', 'trialed', 'revoked', 'failed'
              ));
          ALTER TABLE social_work_tasks
            ADD COLUMN practice_candidate_json TEXT NOT NULL DEFAULT 'null';
          ALTER TABLE social_work_tasks
            ADD COLUMN practice_basis_task_id TEXT;
          ALTER TABLE social_work_tasks
            ADD COLUMN practice_trial_task_id TEXT;
          ALTER TABLE social_work_tasks
            ADD COLUMN practice_trial_task_status TEXT;
          ALTER TABLE social_work_tasks
            ADD COLUMN practice_trial_verification_status TEXT;
          ALTER TABLE social_work_tasks
            ADD COLUMN practice_snapshot_json TEXT NOT NULL DEFAULT 'null';
          CREATE INDEX social_work_practice_candidates
            ON social_work_tasks(agent_id, workspace_key, practice_candidate_status, completed_at);

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (6, '${isoNow()}');
        `);
    })();
  }
  if (current < 7) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_messages
            ADD COLUMN interaction_adjustment_ids_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE social_messages
            ADD COLUMN interaction_adjustment_snapshots_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE social_work_tasks
            ADD COLUMN interaction_adjustment_ids_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE social_work_tasks
            ADD COLUMN interaction_adjustment_snapshots_json TEXT NOT NULL DEFAULT '[]';

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (7, '${isoNow()}');
        `);
    })();
  }
  if (current < 8) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_messages
            ADD COLUMN interaction_adjustment_attempts_json TEXT NOT NULL DEFAULT '[]';

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (8, '${isoNow()}');
        `);
    })();
  }
  if (current < 9) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_rooms
            ADD COLUMN parent_room_id TEXT REFERENCES social_rooms(id) ON DELETE CASCADE;
          ALTER TABLE social_rooms
            ADD COLUMN origin_message_id TEXT REFERENCES social_messages(id) ON DELETE CASCADE;
          ALTER TABLE social_rooms ADD COLUMN closed_at TEXT;
          CREATE INDEX social_rooms_parent_order
            ON social_rooms(parent_room_id, closed_at, updated_at);

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (9, '${isoNow()}');
        `);
    })();
  }
  if (current < 10) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_work_tasks
            ADD COLUMN source_message_id TEXT REFERENCES social_messages(id) ON DELETE SET NULL;
          CREATE INDEX social_work_tasks_source_message
            ON social_work_tasks(source_message_id);
          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (10, '${isoNow()}');
        `);
    })();
  }
  if (current < 11) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_messages
            ADD COLUMN history_search_status TEXT NOT NULL DEFAULT 'not_searched'
              CHECK (history_search_status IN ('not_searched', 'found', 'no_match'));
          ALTER TABLE social_messages
            ADD COLUMN history_sources_included INTEGER NOT NULL DEFAULT 0
              CHECK (history_sources_included IN (0, 1));

          CREATE TABLE social_message_history_sources (
            assistant_message_id TEXT NOT NULL
              REFERENCES social_messages(id) ON DELETE CASCADE,
            source_message_id TEXT NOT NULL
              REFERENCES social_messages(id) ON DELETE CASCADE,
            position INTEGER NOT NULL CHECK (position >= 0),
            snippet TEXT NOT NULL,
            redacted INTEGER NOT NULL CHECK (redacted IN (0, 1)),
            PRIMARY KEY (assistant_message_id, source_message_id),
            UNIQUE (assistant_message_id, position)
          );
          CREATE INDEX social_message_history_sources_source
            ON social_message_history_sources(source_message_id);

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (11, '${isoNow()}');
        `);
    })();
  }
  if (current < 12) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            brief TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'awaiting_user', 'archived')),
            origin_room_id TEXT REFERENCES social_rooms(id) ON DELETE SET NULL,
            source_message_id TEXT REFERENCES social_messages(id) ON DELETE SET NULL,
            group_room_id TEXT NOT NULL UNIQUE
              REFERENCES social_rooms(id) ON DELETE RESTRICT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            archived_at TEXT,
            CHECK ((status = 'archived') = (archived_at IS NOT NULL))
          );

          CREATE INDEX social_projects_status_updated
            ON social_projects(status, updated_at DESC);

          CREATE TABLE social_project_sessions (
            project_id TEXT NOT NULL
              REFERENCES social_projects(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL
              REFERENCES social_agents(id) ON DELETE RESTRICT,
            room_id TEXT NOT NULL UNIQUE
              REFERENCES social_rooms(id) ON DELETE RESTRICT,
            status TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'removed')),
            joined_at TEXT NOT NULL,
            removed_at TEXT,
            PRIMARY KEY (project_id, agent_id),
            CHECK ((status = 'removed') = (removed_at IS NOT NULL))
          );

          CREATE INDEX social_project_sessions_agent_status
            ON social_project_sessions(agent_id, status, project_id);

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (12, '${isoNow()}');
        `);
    })();
  }
  if (current < 13) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_work_execution_steps (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL
              REFERENCES social_work_tasks(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL CHECK (ordinal > 0),
            external_call_id TEXT,
            tool_name TEXT NOT NULL,
            category TEXT NOT NULL CHECK (
              category IN ('read', 'search', 'write', 'edit', 'command', 'other')
            ),
            has_side_effect INTEGER NOT NULL CHECK (has_side_effect IN (0, 1)),
            status TEXT NOT NULL CHECK (
              status IN ('running', 'succeeded', 'failed', 'outcome_unknown', 'interrupted')
            ),
            effect_status TEXT NOT NULL CHECK (
              effect_status IN ('none', 'pending', 'applied', 'not_applied', 'unknown')
            ),
            started_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE (task_id, ordinal)
          );
          CREATE INDEX social_work_execution_steps_task_order
            ON social_work_execution_steps(task_id, ordinal);
          CREATE INDEX social_work_execution_steps_external_call
            ON social_work_execution_steps(task_id, external_call_id, ordinal);

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (13, '${isoNow()}');
        `);
    })();
  }
  if (current < 14) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_work_tasks
            ADD COLUMN execution_engine TEXT NOT NULL DEFAULT 'dsh';
          UPDATE social_work_tasks SET execution_engine = runtime;
          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (14, '${isoNow()}');
        `);
    })();
  }
  if (current < 15) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_project_reviews (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE RESTRICT,
            request_message_id TEXT NOT NULL UNIQUE REFERENCES social_messages(id) ON DELETE RESTRICT,
            question TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
            feedback TEXT,
            feedback_message_id TEXT REFERENCES social_messages(id) ON DELETE RESTRICT,
            created_at TEXT NOT NULL,
            responded_at TEXT,
            CHECK ((status = 'answered') = (feedback_message_id IS NOT NULL AND feedback IS NOT NULL AND responded_at IS NOT NULL))
          );
          CREATE UNIQUE INDEX social_project_reviews_one_pending
            ON social_project_reviews(project_id) WHERE status = 'pending';
          CREATE INDEX social_project_reviews_room ON social_project_reviews(room_id, created_at);
          INSERT INTO social_schema_migrations (version, applied_at) VALUES (15, '${isoNow()}');
        `);
    })();
  }
  if (current < 16) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_work_runtime_checkpoints (
            task_id TEXT PRIMARY KEY
              REFERENCES social_work_tasks(id) ON DELETE CASCADE,
            messages_json TEXT NOT NULL,
            round INTEGER NOT NULL CHECK (round >= 0),
            tool_call_count INTEGER NOT NULL CHECK (tool_call_count >= 0),
            phase TEXT NOT NULL CHECK (
              phase IN ('ready_for_model', 'tool_pending', 'completed', 'failed', 'interrupted')
            ),
            resume_phase TEXT CHECK (
              resume_phase IS NULL OR resume_phase = 'ready_for_model'
            ),
            updated_at TEXT NOT NULL
          );
          ALTER TABLE social_work_execution_steps
            ADD COLUMN arguments_json TEXT NOT NULL DEFAULT 'null';
          ALTER TABLE social_work_execution_steps ADD COLUMN result_json TEXT;
          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (16, '${isoNow()}');
        `);
    })();
  }
  if (current < 17) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_messages
            ADD COLUMN sender_agent_id TEXT REFERENCES social_agents(id) ON DELETE SET NULL;
          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (17, '${isoNow()}');
        `);
    })();
  }
  if (current < 18) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_project_group_inbox (
            turn_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            group_room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE RESTRICT,
            session_room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE RESTRICT,
            group_user_message_id TEXT NOT NULL UNIQUE
              REFERENCES social_messages(id) ON DELETE CASCADE,
            queued_at TEXT NOT NULL
          );
          CREATE INDEX social_project_group_inbox_order
            ON social_project_group_inbox(group_room_id, queued_at, turn_id);
          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (18, '${isoNow()}');
        `);
    })();
  }
  if (current < 19) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_project_reports (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            source_turn_id TEXT NOT NULL UNIQUE,
            source_user_message_id TEXT NOT NULL
              REFERENCES social_messages(id) ON DELETE RESTRICT,
            source_group_assistant_message_id TEXT NOT NULL
              REFERENCES social_messages(id) ON DELETE RESTRICT,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE RESTRICT,
            group_room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
            session_room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE RESTRICT,
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'processing', 'completed', 'interrupted', 'failed')),
            noema_assistant_message_id TEXT UNIQUE
              REFERENCES social_messages(id) ON DELETE SET NULL,
            error_code TEXT,
            error_message TEXT,
            resident_seen_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            CHECK ((status = 'completed') = (completed_at IS NOT NULL))
          );
          CREATE INDEX social_project_reports_status_order
            ON social_project_reports(status, created_at, id);
          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (19, '${isoNow()}');
        `);
    })();
  }
  if (current < 20) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_agent_asset_revisions (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision > 0),
            content TEXT NOT NULL DEFAULT '',
            is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
            reason TEXT NOT NULL,
            source_turn_id TEXT,
            source_project_id TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (agent_id, path, revision),
            CHECK ((is_deleted = 1) OR length(content) > 0)
          );
          CREATE INDEX social_agent_asset_revisions_latest
            ON social_agent_asset_revisions(agent_id, path, revision DESC);
          CREATE UNIQUE INDEX social_agent_asset_revisions_turn_once
            ON social_agent_asset_revisions(agent_id, path, source_turn_id)
            WHERE source_turn_id IS NOT NULL;
          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (20, '${isoNow()}');
        `);
    })();
  }
  if (current < 21) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_project_plan_revisions (
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL CHECK (revision > 0),
            stage TEXT NOT NULL,
            objective TEXT NOT NULL,
            items_json TEXT NOT NULL,
            actor_agent_id TEXT REFERENCES social_agents(id) ON DELETE SET NULL,
            source_turn_id TEXT,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (project_id, revision)
          );
          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (21, '${isoNow()}');
        `);
    })();
  }
  if (current < 22) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_project_group_inbox RENAME TO social_project_group_inbox_v21;
          DROP INDEX social_project_group_inbox_order;
          CREATE TABLE social_project_group_inbox (
            turn_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            group_room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE RESTRICT,
            session_room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE RESTRICT,
            group_user_message_id TEXT NOT NULL REFERENCES social_messages(id) ON DELETE CASCADE,
            queued_at TEXT NOT NULL,
            root_id TEXT,
            depth INTEGER NOT NULL DEFAULT 0,
            trigger_kind TEXT NOT NULL DEFAULT 'mention',
            plan_item_id TEXT
          );
          INSERT INTO social_project_group_inbox
            (turn_id, project_id, group_room_id, agent_id, session_room_id, group_user_message_id, queued_at)
            SELECT turn_id, project_id, group_room_id, agent_id, session_room_id, group_user_message_id, queued_at
            FROM social_project_group_inbox_v21;
          DROP TABLE social_project_group_inbox_v21;
          CREATE INDEX social_project_group_inbox_order ON social_project_group_inbox(group_room_id, queued_at, turn_id);
          CREATE TABLE social_project_dispatch_log (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            source_message_id TEXT NOT NULL REFERENCES social_messages(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE RESTRICT,
            root_id TEXT NOT NULL,
            depth INTEGER NOT NULL,
            trigger_kind TEXT NOT NULL,
            plan_item_id TEXT,
            assistant_message_id TEXT REFERENCES social_messages(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            UNIQUE(source_message_id, agent_id)
          );
          CREATE INDEX social_project_dispatch_root ON social_project_dispatch_log(root_id);
          CREATE TABLE social_project_read_cursors (
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE CASCADE,
            last_seq INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(project_id, agent_id)
          );
          CREATE TABLE social_project_publications (
            event_key TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            message_id TEXT NOT NULL UNIQUE REFERENCES social_messages(id) ON DELETE CASCADE
          );
          INSERT INTO social_schema_migrations(version, applied_at) VALUES (22, '${isoNow()}');
        `);
    })();
  }
  if (current < 23) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_project_growth_batches (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
            plan_revision INTEGER NOT NULL CHECK (plan_revision > 0),
            status TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running', 'completed')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE (project_id, plan_revision),
            CHECK ((status = 'completed') = (completed_at IS NOT NULL))
          );
          CREATE TABLE social_project_growth_members (
            batch_id TEXT NOT NULL REFERENCES social_project_growth_batches(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE RESTRICT,
            session_room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE RESTRICT,
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'running', 'completed', 'no_change', 'interrupted', 'failed')),
            turn_id TEXT UNIQUE,
            brief TEXT,
            error_code TEXT,
            error_message TEXT,
            resident_seen_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            PRIMARY KEY (batch_id, agent_id),
            CHECK ((status IN ('completed', 'no_change')) = (completed_at IS NOT NULL)),
            CHECK ((status IN ('completed', 'no_change')) = (brief IS NOT NULL))
          );
          CREATE INDEX social_project_growth_members_status
            ON social_project_growth_members(batch_id, status, created_at);
          INSERT INTO social_schema_migrations(version, applied_at)
          VALUES (23, '${isoNow()}');
        `);
    })();
  }
  if (current < 24) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_project_growth_batches
            ADD COLUMN finalized_at TEXT;
          INSERT INTO social_schema_migrations(version, applied_at)
          VALUES (24, '${isoNow()}');
        `);
    })();
  }
  if (current < 25) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_work_tasks ADD COLUMN project_plan_item_id TEXT;
          ALTER TABLE social_work_tasks ADD COLUMN project_result_pending INTEGER NOT NULL DEFAULT 0
            CHECK(project_result_pending IN (0,1));
          INSERT INTO social_schema_migrations(version, applied_at) VALUES (25, '${isoNow()}');
        `);
      db.prepare(`UPDATE social_agents SET system_prompt=replace(system_prompt,?,?)
          WHERE kind='specialist' AND instr(system_prompt,?)>0`).run(
        LEGACY_FILE_TASK_GUIDANCE,
        FILE_TASK_GUIDANCE,
        LEGACY_FILE_TASK_GUIDANCE,
      );
    })();
  }
  if (current < 26) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_project_group_inbox
            ADD COLUMN plan_submission_revision INTEGER
              CHECK (plan_submission_revision IS NULL OR plan_submission_revision > 0);
          INSERT INTO social_schema_migrations(version, applied_at)
          VALUES (26, '${isoNow()}');
        `);
    })();
  }
  if (current < 27) {
    const foreignKeysEnabled = db.pragma('foreign_keys', {
      simple: true,
    });
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(`
            CREATE TABLE social_messages_provider_runtime (
              seq INTEGER PRIMARY KEY AUTOINCREMENT,
              id TEXT NOT NULL UNIQUE,
              room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
              turn_id TEXT NOT NULL,
              role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
              agent_id TEXT REFERENCES social_agents(id) ON DELETE SET NULL,
              content TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'interrupted', 'failed')),
              attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
              model TEXT,
              runtime TEXT NOT NULL CHECK (runtime IN ('provider', 'freellmapi', 'local', 'system')),
              error_code TEXT,
              error_message TEXT,
              legacy_source_id TEXT UNIQUE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              forwarded_sources_json TEXT NOT NULL DEFAULT '[]',
              reply_to_message_id TEXT,
              reply_to_json TEXT NOT NULL DEFAULT 'null',
              interaction_adjustment_ids_json TEXT NOT NULL DEFAULT '[]',
              interaction_adjustment_snapshots_json TEXT NOT NULL DEFAULT '[]',
              interaction_adjustment_attempts_json TEXT NOT NULL DEFAULT '[]',
              history_search_status TEXT NOT NULL DEFAULT 'not_searched'
                CHECK (history_search_status IN ('not_searched', 'found', 'no_match')),
              history_sources_included INTEGER NOT NULL DEFAULT 0
                CHECK (history_sources_included IN (0, 1)),
              sender_agent_id TEXT REFERENCES social_agents(id) ON DELETE SET NULL
            );
            INSERT INTO social_messages_provider_runtime (
              seq, id, room_id, turn_id, role, agent_id, content, status,
              attempt, model, runtime, error_code, error_message,
              legacy_source_id, created_at, updated_at, forwarded_sources_json,
              reply_to_message_id, reply_to_json, interaction_adjustment_ids_json,
              interaction_adjustment_snapshots_json,
              interaction_adjustment_attempts_json, history_search_status,
              history_sources_included, sender_agent_id
            )
            SELECT
              seq, id, room_id, turn_id, role, agent_id, content, status,
              attempt, model, runtime, error_code, error_message,
              legacy_source_id, created_at, updated_at, forwarded_sources_json,
              reply_to_message_id, reply_to_json, interaction_adjustment_ids_json,
              interaction_adjustment_snapshots_json,
              interaction_adjustment_attempts_json, history_search_status,
              history_sources_included, sender_agent_id
            FROM social_messages;
            DROP TABLE social_messages;
            ALTER TABLE social_messages_provider_runtime RENAME TO social_messages;
            CREATE INDEX social_messages_room_order
              ON social_messages(room_id, seq);
            CREATE INDEX social_messages_turn_attempt
              ON social_messages(turn_id, attempt, role);
            INSERT INTO social_schema_migrations(version, applied_at)
            VALUES (27, '${isoNow()}');
          `);
      })();
    } finally {
      db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
    }
  }
}
