import type { ChatRun } from './chat-run.ts';
import { needsWebSearch } from '../tools/web-search.mjs';
import {
  extractUserUrls,
  MAX_EXTERNAL_SOURCES_PER_MESSAGE,
} from '../tools/web-source.mjs';

export class ProjectSourcePolicy {
  declare projectStore: import('../projects/social-project-store.mjs').SocialProjectStore;
  declare store: import('./social-chat-store.mjs').SocialChatStore;
  declare searchPublicSources:
    | ((...args: any[]) => Promise<any>)
    | null
    | undefined;
  declare isWebSearchConfigured: () => boolean;

  constructor({
    projectStore,
    store,
    searchPublicSources,
    isWebSearchConfigured,
  }: {
    projectStore: ProjectSourcePolicy['projectStore'];
    store: ProjectSourcePolicy['store'];
    searchPublicSources: ProjectSourcePolicy['searchPublicSources'];
    isWebSearchConfigured: () => boolean;
  }) {
    this.projectStore = projectStore;
    this.store = store;
    this.searchPublicSources = searchPublicSources;
    this.isWebSearchConfigured = isWebSearchConfigured;
  }

  accessibleProjects(run: ChatRun) {
    if (!this.projectStore) return [];
    if (run.projectContext)
      return [this.projectStore.getProject(run.projectContext.projectId)];
    if (run.reviewContext)
      return [this.projectStore.getProject(run.reviewContext.projectId)];
    if (run.agentId !== 'noema') return [];
    return this.projectStore
      .listProjects({ includeArchived: true })
      .filter(
        (p: { groupRoomId?: string | null }) =>
          run.roomId === 'room-noema' || p.groupRoomId === run.roomId,
      )
      .slice(0, 32);
  }

  canResearchPublicSources(run: ChatRun) {
    if (
      !run.projectContext?.sourceMessageId ||
      run.projectContext.groupRoomId !== run.roomId ||
      !this.searchPublicSources ||
      !this.isWebSearchConfigured()
    )
      return false;
    try {
      const sourceIds = [
        run.userMessageId,
        run.projectContext.sourceMessageId,
      ].filter(Boolean);
      const authorizedByUser = sourceIds.some((sourceId) => {
        const source = this.store.getSocialMessage(sourceId);
        return (
          source.role === 'user' &&
          source.senderAgentId === null &&
          source.status === 'complete' &&
          needsWebSearch(source.content)
        );
      });
      return authorizedByUser && needsWebSearch(run.text);
    } catch {
      return false;
    }
  }

  authorizedProjectSourceUrls(run: ChatRun) {
    if (!run.projectContext || run.projectContext.groupRoomId !== run.roomId)
      return [];
    const messages = new Map();
    for (const sourceId of [
      run.projectContext.sourceMessageId,
      run.userMessageId,
    ]) {
      if (!sourceId) continue;
      try {
        const source = this.store.getSocialMessage(sourceId);
        if (
          !source ||
          source.role !== 'user' ||
          source.senderAgentId !== null ||
          source.status !== 'complete' ||
          (sourceId === run.userMessageId && source.roomId !== run.roomId)
        )
          continue;
        messages.set(source.id, source);
      } catch {
        continue;
      }
    }
    try {
      for (const source of this.store.listRecentUserMessagesWithLinks(
        run.roomId,
        128,
      )) {
        if (
          source.role === 'user' &&
          source.senderAgentId === null &&
          source.status === 'complete' &&
          source.roomId === run.roomId
        )
          messages.set(source.id, source);
      }
    } catch {
      // Keep the original-request/current-message allowlist if history lookup fails.
    }
    const urls = [...messages.values()].flatMap((source) =>
      extractUserUrls(source.content, 128),
    );
    return [...new Set(urls)];
  }

  projectSourceReadBudget(run: ChatRun) {
    const successfulDirectReads =
      run.projectResearchDirectSourceUrls?.size ?? 0;
    const failedDirectAttempts = Math.max(
      0,
      (run.projectResearchAttemptedUrls?.size ?? 0) - successfulDirectReads,
    );
    return Math.max(
      0,
      MAX_EXTERNAL_SOURCES_PER_MESSAGE -
        (run.projectResearchSources?.length ?? 0) -
        failedDirectAttempts,
    );
  }
}
