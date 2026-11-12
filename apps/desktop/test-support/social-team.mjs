import { randomUUID } from 'node:crypto';
import { SocialChatStore } from '../src/main/chat/social-chat-store.mjs';

// Explicit test data. A real first launch contains only Noema, not a fabricated
// engineering team or collaboration history. Never import this from app code.
export function createSocialTestStore(db, options = {}) {
  const store = new SocialChatStore(db, options);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO social_agents
        (id, name, kind, headline, description, system_prompt, capabilities_json, created_at, updated_at)
      VALUES ('engineering-partner', '工程搭档', 'specialist', '软件项目与技术探索',
        '围绕软件构建、技术判断和迭代验证持续协作。',
        '你是长期存在的工程搭档，擅长软件项目与技术探索。不得声称掌握未提供的项目事实或未授权的其他私聊。',
        '["project-work"]', ?, ?)
    `).run(now, now);
    const insertRoom = db.prepare(`
      INSERT OR IGNORE INTO social_rooms (id, kind, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertRoom.run('room-engineering-partner', 'direct', '工程搭档', now, now);
    insertRoom.run(
      'room-engineering-collaboration',
      'group',
      '工程协作',
      now,
      now,
    );
    const member = db.prepare(`
      INSERT OR IGNORE INTO social_room_members (room_id, agent_id, position) VALUES (?, ?, ?)
    `);
    member.run('room-engineering-partner', 'engineering-partner', 0);
    member.run('room-engineering-collaboration', 'noema', 0);
    member.run('room-engineering-collaboration', 'engineering-partner', 1);
    const message = db.prepare(`
      INSERT INTO social_messages
        (id, room_id, turn_id, role, content, status, runtime, created_at, updated_at)
      SELECT ?, ?, ?, 'system', ?, 'complete', 'system', ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM social_messages WHERE room_id = ?)
    `);
    for (const roomId of [
      'room-engineering-partner',
      'room-engineering-collaboration',
    ]) {
      message.run(
        randomUUID(),
        roomId,
        randomUUID(),
        '用于自动化检查的工程协作样例。',
        now,
        now,
        roomId,
      );
    }
  })();
  return store;
}
