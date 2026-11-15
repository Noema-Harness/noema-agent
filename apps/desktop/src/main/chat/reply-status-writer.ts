import { stripToolCallMarkup } from '../providers/openai-compatible-client.mjs';
import type { ChatRun } from './chat-run.ts';

export class ReplyStatusWriter {
  declare store: import('./social-chat-store.mjs').SocialChatStore;
  declare projectStore: import('../projects/social-project-store.mjs').SocialProjectStore;
  declare assistantMessageIds: (run: ChatRun) => string[];
  declare finalizeCompletedProjectGrowthBatches: () => unknown;

  constructor({
    store,
    projectStore,
    assistantMessageIds,
    finalizeCompletedProjectGrowthBatches,
  }: {
    store: ReplyStatusWriter['store'];
    projectStore: ReplyStatusWriter['projectStore'];
    assistantMessageIds: ReplyStatusWriter['assistantMessageIds'];
    finalizeCompletedProjectGrowthBatches: ReplyStatusWriter['finalizeCompletedProjectGrowthBatches'];
  }) {
    this.store = store;
    this.projectStore = projectStore;
    this.assistantMessageIds = assistantMessageIds;
    this.finalizeCompletedProjectGrowthBatches =
      finalizeCompletedProjectGrowthBatches;
  }

  setRunReplyStatus(
    run: ChatRun,
    status: string,
    code: string | null = null,
    message: string | null = null,
  ) {
    const ids = this.assistantMessageIds(run);
    if (run.isProjectGrowthTurn) {
      let updated;
      if (status === 'complete') updated = this.store.completeReply(ids[0]);
      else if (status === 'interrupted')
        updated = this.store.interruptReply(ids[0]);
      else if (status === 'failed')
        updated = this.store.failReply(ids[0], code, message);
      else throw new TypeError('成员成长回复状态无效。');
      if (!updated) return false;
      if (status === 'complete') {
        const reply = this.store.getSocialMessage(ids[0]);
        const content = reply?.content?.trim() ?? '';
        if (!content) return false;
        const hasAssetChange = Boolean(
          this.store.db
            .prepare(`
              SELECT 1 FROM social_agent_asset_revisions
              WHERE agent_id = ? AND source_project_id = ? AND source_turn_id = ?
              LIMIT 1
            `)
            .get(run.agentId, run.projectContext.projectId, run.turnId),
        );
        try {
          const batch = this.projectStore.finishProjectGrowthMember(
            run.projectGrowthBatchId,
            run.agentId,
            {
              status: hasAssetChange ? 'completed' : 'no_change',
              // Only a real asset revision carries experience; the visible text
              // is what the resident chat should read later, without tool markup.
              brief: hasAssetChange
                ? stripToolCallMarkup(content).slice(0, 4_000) || null
                : null,
            },
          );
          if (batch.status === 'completed') {
            this.finalizeCompletedProjectGrowthBatches();
          }
        } catch (error) {
          this.projectStore.failProjectGrowthMember(
            run.projectGrowthBatchId,
            run.agentId,
            {
              status: 'failed',
              code: 'growth_result_persist_failed',
              message: (error as Error | null)?.message ?? '成长结果没有保存。',
            },
          );
          return false;
        }
      } else {
        this.projectStore.failProjectGrowthMember(
          run.projectGrowthBatchId,
          run.agentId,
          {
            status,
            code,
            message,
          },
        );
      }
      return true;
    }
    if (run.isProjectReportTurn) {
      return this.store.finishProjectReport(ids[0], status, code, message);
    }
    if (ids.length > 1) {
      if (status === 'complete')
        return this.store.completeReplies(ids, run.projectReport ?? null);
      if (status === 'interrupted') return this.store.interruptReplies(ids);
      if (status === 'failed')
        return this.store.failReplies(ids, code, message);
      throw new TypeError('项目回复状态无效。');
    }
    if (status === 'complete') return this.store.completeReply(ids[0]);
    if (status === 'interrupted') return this.store.interruptReply(ids[0]);
    if (status === 'failed') return this.store.failReply(ids[0], code, message);
    throw new TypeError('项目回复状态无效。');
  }
}
