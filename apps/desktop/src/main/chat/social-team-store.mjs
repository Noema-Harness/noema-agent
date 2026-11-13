export class SocialTeamStore {
  constructor({ db }) {
    this.db = db;
  }

  listTeams({ includeArchived = true } = {}) {
    const rows = this.db
      .prepare(`
        SELECT t.id, t.title, t.brief, t.status,
               t.lead_agent_id AS leadAgentId,
               t.group_room_id AS groupRoomId,
               t.created_at AS createdAt,
               t.updated_at AS updatedAt,
               t.archived_at AS archivedAt,
               p.id AS projectId
        FROM social_teams AS t
        LEFT JOIN social_projects AS p ON p.team_id = t.id
        WHERE (? = 1 OR t.status <> 'archived')
        ORDER BY t.updated_at DESC, t.created_at DESC
      `)
      .all(includeArchived ? 1 : 0);
    const members = this.db.prepare(`
      SELECT m.agent_id AS agentId, m.role,
             a.name, a.headline, a.kind, a.archived_at AS agentArchivedAt
      FROM social_team_members AS m
      JOIN social_agents AS a ON a.id = m.agent_id
      WHERE m.team_id = ? AND m.removed_at IS NULL
      ORDER BY CASE m.role WHEN 'lead' THEN 0 ELSE 1 END, m.joined_at
    `);
    return rows.map((row) => ({
      ...row,
      members: members.all(row.id),
    }));
  }
}
