import { SOCIAL_SCHEMA_VERSION } from './social-chat-schema.mjs';
import {
  addConversationContinuitySchema,
  backfillConversationContinuity,
} from './conversation-continuity.mjs';
import {
  LEGACY_FILE_TASK_GUIDANCE,
  FILE_TASK_GUIDANCE,
  isoNow,
} from './records.mjs';

export function migrateSocialChatSchema(
  db,
  { targetVersion = SOCIAL_SCHEMA_VERSION } = {},
) {
  if (
    !Number.isInteger(targetVersion) ||
    targetVersion < 1 ||
    targetVersion > SOCIAL_SCHEMA_VERSION
  ) {
    throw new Error(
      `Social chat target schema ${targetVersion} is outside the supported range.`,
    );
  }
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
  if (current > targetVersion) {
    throw new Error(
      `Social chat schema ${current} is newer than the requested target ${targetVersion}.`,
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
  if (current < 28) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_messages
            ADD COLUMN delegation_parent_message_id TEXT
              REFERENCES social_messages(id) ON DELETE SET NULL;
          CREATE UNIQUE INDEX social_messages_delegation_parent
            ON social_messages(delegation_parent_message_id)
            WHERE delegation_parent_message_id IS NOT NULL;
          INSERT INTO social_schema_migrations(version, applied_at)
          VALUES (28, '${isoNow()}');
        `);
    })();
  }
  if (current < 29) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE IF NOT EXISTS social_user_memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
            source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'message')),
            source_room_id TEXT REFERENCES social_rooms(id) ON DELETE SET NULL,
            source_message_id TEXT REFERENCES social_messages(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (
              (source_kind = 'manual' AND source_room_id IS NULL AND source_message_id IS NULL)
              OR (source_kind = 'message' AND (source_message_id IS NULL OR source_room_id IS NOT NULL))
            )
          );
          CREATE INDEX IF NOT EXISTS social_user_memories_updated
            ON social_user_memories(updated_at DESC, id);
          CREATE VIRTUAL TABLE IF NOT EXISTS social_user_memories_fts
            USING fts5(memory_id UNINDEXED, content, tokenize='trigram');
          INSERT INTO social_schema_migrations(version, applied_at)
          VALUES (29, '${isoNow()}');
        `);
    })();
  }
  if (current < 30) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_user_followups (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
            body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
            due_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'delivering', 'delivered', 'canceled')),
            source_room_id TEXT REFERENCES social_rooms(id) ON DELETE SET NULL,
            source_message_id TEXT REFERENCES social_messages(id) ON DELETE SET NULL,
            delivery_lease_until TEXT,
            delivered_at TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX social_user_followups_due
            ON social_user_followups(status, due_at, delivery_lease_until);
          CREATE INDEX social_user_followups_history
            ON social_user_followups(updated_at DESC, id);
          INSERT INTO app_settings(key, value, updated_at)
            VALUES ('user_followups_enabled', 'true', '${isoNow()}')
            ON CONFLICT(key) DO NOTHING;
          INSERT INTO social_schema_migrations(version, applied_at)
            VALUES (30, '${isoNow()}');
        `);
    })();
  }
  if (current < 31) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE application_shutdown_intent (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            reason TEXT NOT NULL CHECK (reason IN ('application_exit', 'system_shutdown')),
            requested_at TEXT NOT NULL
          );
          INSERT INTO social_schema_migrations(version, applied_at)
            VALUES (31, '${isoNow()}');
        `);
    })();
  }
  if (current < 32) {
    db.transaction(() => {
      db.exec(`
          ALTER TABLE social_projects ADD COLUMN workspace_path TEXT;
          ALTER TABLE social_projects ADD COLUMN workspace_identity_json TEXT;
          ALTER TABLE social_work_tasks ADD COLUMN workspace_identity_json TEXT;
          INSERT INTO social_schema_migrations(version, applied_at)
            VALUES (32, '${isoNow()}');
        `);
    })();
  }
  if (current < 33) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_work_file_changes (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES social_work_tasks(id) ON DELETE CASCADE,
            relative_path TEXT NOT NULL,
            original_exists INTEGER NOT NULL CHECK (original_exists IN (0, 1)),
            original_bytes BLOB,
            original_hash TEXT,
            latest_hash TEXT,
            diff_text TEXT NOT NULL DEFAULT '',
            diff_truncated INTEGER NOT NULL DEFAULT 0 CHECK (diff_truncated IN (0, 1)),
            state TEXT NOT NULL CHECK (
              state IN ('pending', 'applied', 'unknown', 'not_applied', 'kept', 'reverted', 'conflict')
            ),
            pending_before_hash TEXT,
            pending_after_hash TEXT,
            pending_diff_text TEXT,
            pending_diff_truncated INTEGER CHECK (
              pending_diff_truncated IS NULL OR pending_diff_truncated IN (0, 1)
            ),
            pending_step_id TEXT REFERENCES social_work_execution_steps(id) ON DELETE SET NULL,
            last_step_id TEXT REFERENCES social_work_execution_steps(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (
              (original_exists = 1 AND original_hash IS NOT NULL AND
                (original_bytes IS NOT NULL OR state IN ('kept', 'reverted', 'not_applied')))
              OR (original_exists = 0 AND original_bytes IS NULL AND original_hash IS NULL)
            ),
            CHECK (
              (state = 'pending' AND pending_after_hash IS NOT NULL AND pending_step_id IS NOT NULL)
              OR (state <> 'pending' AND pending_after_hash IS NULL AND pending_step_id IS NULL)
            )
          );
          CREATE INDEX social_work_file_changes_task_order
            ON social_work_file_changes(task_id, created_at, relative_path);
          CREATE UNIQUE INDEX social_work_file_changes_one_open_path
            ON social_work_file_changes(task_id, relative_path)
            WHERE state IN ('pending', 'applied', 'unknown', 'conflict');
          CREATE TABLE social_work_file_change_operations (
            id TEXT PRIMARY KEY,
            change_id TEXT NOT NULL REFERENCES social_work_file_changes(id) ON DELETE CASCADE,
            task_id TEXT NOT NULL REFERENCES social_work_tasks(id) ON DELETE CASCADE,
            step_id TEXT NOT NULL REFERENCES social_work_execution_steps(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL CHECK (ordinal > 0),
            before_hash TEXT,
            after_hash TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('pending', 'applied', 'not_applied', 'unknown')),
            created_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE (change_id, ordinal),
            UNIQUE (step_id)
          );
          CREATE INDEX social_work_file_change_operations_task
            ON social_work_file_change_operations(task_id, created_at, id);
          INSERT INTO social_schema_migrations(version, applied_at)
            VALUES (33, '${isoNow()}');
        `);
    })();
  }
  if (current < 34 && targetVersion >= 34) {
    db.transaction(() => {
      db.exec(`
          CREATE TABLE social_work_command_batches (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES social_work_tasks(id) ON DELETE CASCADE,
            step_id TEXT NOT NULL REFERENCES social_work_execution_steps(id) ON DELETE CASCADE,
            workspace_key TEXT NOT NULL CHECK (length(workspace_key) = 64),
            mirror_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK (status IN (
              'preparing', 'running', 'collecting', 'syncing', 'completed',
              'partial', 'conflict', 'unknown', 'not_applied'
            )),
            workspace_identity_json TEXT NOT NULL,
            base_manifest_hash TEXT,
            final_manifest_hash TEXT,
            reason_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (task_id, step_id)
          );
          CREATE INDEX social_work_command_batches_workspace_state
            ON social_work_command_batches(workspace_key, status, created_at);

          CREATE TABLE social_work_change_blobs (
            hash TEXT PRIMARY KEY CHECK (length(hash) = 64),
            size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
            created_at TEXT NOT NULL
          );

          ALTER TABLE social_work_file_change_operations
            RENAME TO social_work_file_change_operations_v33;
          CREATE TABLE social_work_file_change_operations_v33_copy AS
            SELECT * FROM social_work_file_change_operations_v33;
          DROP TABLE social_work_file_change_operations_v33;

          ALTER TABLE social_work_file_changes
            RENAME TO social_work_file_changes_v33;
          CREATE TABLE social_work_file_changes (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES social_work_tasks(id) ON DELETE CASCADE,
            relative_path TEXT NOT NULL,
            original_exists INTEGER NOT NULL CHECK (original_exists IN (0, 1)),
            original_bytes BLOB,
            original_hash TEXT,
            original_blob_hash TEXT,
            original_blob_size INTEGER CHECK (original_blob_size IS NULL OR original_blob_size >= 0),
            latest_hash TEXT,
            latest_exists INTEGER NOT NULL DEFAULT 1 CHECK (latest_exists IN (0, 1)),
            diff_text TEXT NOT NULL DEFAULT '',
            diff_truncated INTEGER NOT NULL DEFAULT 0 CHECK (diff_truncated IN (0, 1)),
            state TEXT NOT NULL CHECK (
              state IN ('pending', 'applied', 'unknown', 'not_applied', 'kept', 'reverted', 'conflict')
            ),
            pending_before_hash TEXT,
            pending_after_hash TEXT,
            pending_after_exists INTEGER CHECK (
              pending_after_exists IS NULL OR pending_after_exists IN (0, 1)
            ),
            pending_diff_text TEXT,
            pending_diff_truncated INTEGER CHECK (
              pending_diff_truncated IS NULL OR pending_diff_truncated IN (0, 1)
            ),
            pending_step_id TEXT REFERENCES social_work_execution_steps(id) ON DELETE SET NULL,
            last_step_id TEXT REFERENCES social_work_execution_steps(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (
              (original_exists = 1 AND original_hash IS NOT NULL AND
                (original_bytes IS NOT NULL OR original_blob_hash IS NOT NULL OR
                 state IN ('kept', 'reverted', 'not_applied', 'conflict')))
              OR (original_exists = 0 AND original_bytes IS NULL AND
                  original_hash IS NULL AND original_blob_hash IS NULL)
            ),
            CHECK (
              (state = 'pending' AND pending_step_id IS NOT NULL AND
                pending_after_exists IS NOT NULL)
              OR (state <> 'pending' AND pending_step_id IS NULL AND
                  pending_after_exists IS NULL)
            )
          );
          INSERT INTO social_work_file_changes (
            id, task_id, relative_path, original_exists, original_bytes,
            original_hash, latest_hash, latest_exists, diff_text, diff_truncated,
            state, pending_before_hash, pending_after_hash, pending_after_exists,
            pending_diff_text, pending_diff_truncated, pending_step_id,
            last_step_id, created_at, updated_at, original_blob_hash,
            original_blob_size
          )
          SELECT id, task_id, relative_path, original_exists, original_bytes,
                 original_hash, latest_hash,
                 CASE WHEN latest_hash IS NOT NULL THEN 1 ELSE 0 END,
                 diff_text, diff_truncated, state, pending_before_hash,
                 pending_after_hash,
                 CASE WHEN state = 'pending' THEN 1 ELSE NULL END,
                 pending_diff_text, pending_diff_truncated, pending_step_id,
                 last_step_id, created_at, updated_at, NULL, NULL
          FROM social_work_file_changes_v33;
          DROP TABLE social_work_file_changes_v33;
          CREATE INDEX social_work_file_changes_task_order
            ON social_work_file_changes(task_id, created_at, relative_path);
          CREATE UNIQUE INDEX social_work_file_changes_one_open_path
            ON social_work_file_changes(task_id, relative_path)
            WHERE state IN ('pending', 'applied', 'unknown', 'conflict');

          CREATE TABLE social_work_file_change_operations (
            id TEXT PRIMARY KEY,
            change_id TEXT NOT NULL REFERENCES social_work_file_changes(id) ON DELETE CASCADE,
            task_id TEXT NOT NULL REFERENCES social_work_tasks(id) ON DELETE CASCADE,
            step_id TEXT NOT NULL REFERENCES social_work_execution_steps(id) ON DELETE CASCADE,
            command_batch_id TEXT REFERENCES social_work_command_batches(id) ON DELETE SET NULL,
            ordinal INTEGER NOT NULL CHECK (ordinal > 0),
            before_hash TEXT,
            after_hash TEXT,
            before_blob_hash TEXT,
            after_blob_hash TEXT,
            state TEXT NOT NULL CHECK (state IN ('pending', 'applied', 'not_applied', 'unknown')),
            created_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE (change_id, ordinal),
            UNIQUE (step_id, change_id)
          );
          INSERT INTO social_work_file_change_operations (
            id, change_id, task_id, step_id, ordinal, before_hash,
            after_hash, before_blob_hash, after_blob_hash, state, created_at, completed_at
          )
          SELECT id, change_id, task_id, step_id, ordinal, before_hash,
                 after_hash, NULL, NULL, state, created_at, completed_at
          FROM social_work_file_change_operations_v33_copy;
          DROP TABLE social_work_file_change_operations_v33_copy;
          CREATE INDEX social_work_file_change_operations_task
            ON social_work_file_change_operations(task_id, created_at, id);
          CREATE INDEX social_work_file_change_operations_batch
            ON social_work_file_change_operations(command_batch_id, change_id, ordinal);

          CREATE TABLE social_work_workspace_write_locks (
            workspace_key TEXT PRIMARY KEY CHECK (length(workspace_key) = 64),
            task_id TEXT NOT NULL REFERENCES social_work_tasks(id) ON DELETE CASCADE,
            command_batch_id TEXT NOT NULL UNIQUE
              REFERENCES social_work_command_batches(id) ON DELETE CASCADE,
            acquired_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          INSERT INTO social_schema_migrations(version, applied_at)
            VALUES (34, '${isoNow()}');
        `);
    })();
  }
  if (current < 35 && targetVersion >= 35) {
    db.transaction(() => {
      db.prepare(`
        UPDATE social_agents
        SET capabilities_json = '["project-work"]'
        WHERE id = 'noema'
      `).run();
      db.prepare(
        'INSERT INTO social_schema_migrations(version, applied_at) VALUES (35, ?)',
      ).run(isoNow());
    })();
  }
  if (current < 36 && targetVersion >= 36) {
    db.transaction(() => {
      const now = isoNow();
      db.prepare(`
        INSERT INTO social_agents (
          id, name, kind, headline, description, system_prompt,
          capabilities_json, created_at, updated_at
        ) VALUES (?, ?, 'specialist', ?, ?, ?, '["project-work"]', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          headline = excluded.headline,
          description = excluded.description,
          system_prompt = excluded.system_prompt,
          capabilities_json = excluded.capabilities_json,
          updated_at = excluded.updated_at
      `).run(
        'noema-executor',
        '执行者',
        '按工单独立执行本机任务',
        '接收一张明确工单，在指定工作区内执行并如实报告，不参与项目、团队或群聊。',
        '你是 Noema 的执行者。独立完成一张工单：先检查工作区现状，再直接实现用户要求。不要创建项目团队、群聊或计划阶段。只修改所选工作区内的文件，使用工具后如实报告已完成的动作、验证结果和未验证的部分。',
        now,
        now,
      );
      db.prepare(
        'INSERT INTO social_schema_migrations(version, applied_at) VALUES (36, ?)',
      ).run(now);
    })();
  }
  if (current < 37 && targetVersion >= 37) {
    db.transaction(() => {
      addConversationContinuitySchema(db);
      backfillConversationContinuity(db);
      db.prepare(
        'INSERT INTO social_schema_migrations(version, applied_at) VALUES (37, ?)',
      ).run(isoNow());
    })();
  }
}
