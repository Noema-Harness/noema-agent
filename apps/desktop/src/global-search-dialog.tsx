import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { IconButton } from './ui/button';
import type {
  NoemaSocialAgent,
  NoemaSocialProject,
  NoemaSocialSearchResult,
} from './noema-bridge.d.ts';
import './global-search-dialog.css';

export function GlobalSearchDialog({
  dialogRef,
  agents,
  projects,
  onClose,
  onAgent,
  onProject,
  onMessage,
}: {
  dialogRef: React.RefObject<HTMLFormElement | null>;
  agents: NoemaSocialAgent[];
  projects: NoemaSocialProject[];
  onClose: (restoreFocus?: boolean) => void;
  onAgent: (agent: NoemaSocialAgent) => Promise<void>;
  onProject: (project: NoemaSocialProject) => Promise<void>;
  onMessage: (message: NoemaSocialSearchResult) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<{
    query: string;
    items: NoemaSocialSearchResult[];
  }>({ query: '', items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const needle = query.trim();
  const local = useMemo(() => {
    const normalized = needle.toLocaleLowerCase();
    if (!normalized) return { agents: [], projects: [] };
    return {
      agents: agents
        .filter((agent) =>
          `${agent.name} ${agent.headline}`
            .toLocaleLowerCase()
            .includes(normalized),
        )
        .slice(0, 12),
      projects: projects
        .filter((project) =>
          project.title.toLocaleLowerCase().includes(normalized),
        )
        .slice(0, 12),
    };
  }, [needle, agents, projects]);
  // As in OpenCode search.ts: never leave an earlier query's hits selectable.
  const messages = response.query === needle ? response.items : [];
  useEffect(() => {
    const request = ++version.current;
    setError('');
    if (!needle) {
      setLoading(false);
      setResponse({ query: '', items: [] });
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void window.noema
        .searchSocialMessages(needle)
        .then((items) => {
          if (request === version.current)
            setResponse({ query: needle, items });
        })
        .catch((e) => {
          if (request === version.current) {
            setResponse({ query: needle, items: [] });
            setError(e instanceof Error ? e.message : '消息搜索失败。');
          }
        })
        .finally(() => {
          if (request === version.current) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      version.current++;
    };
  }, [needle, retry]);
  const choose = async (action: () => Promise<void>) => {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      await action();
      onClose(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '来源暂时无法打开。');
    } finally {
      setOpening(false);
    }
  };
  const hasResults =
    local.agents.length + local.projects.length + messages.length > 0;
  const sourceTitle = (message: NoemaSocialSearchResult) => {
    const project = projects.find((project) =>
      project.members.some((member) => member.sessionRoomId === message.roomId),
    );
    return project
      ? `${project.title} · ${message.roomTitle}的项目会话`
      : message.roomTitle;
  };
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !opening) onClose();
      }}
    >
      <form
        ref={dialogRef}
        className="social-dialog global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="global-search-title">全局搜索</h2>
            <p>查找成员、项目和所有聊天中的消息。</p>
          </div>
          <IconButton
            type="button"
            className="icon-button"
            label="关闭全局搜索"
            onClick={() => onClose()}
          >
            ×
          </IconButton>
        </div>
        <Command
          shouldFilter={false}
          loop
          label="全局搜索"
          disablePointerSelection={opening}
        >
          <Command.Input
            aria-label="搜索联系人、项目和消息"
            placeholder="输入名称或消息内容"
            data-dialog-initial-focus
            value={query}
            onValueChange={setQuery}
            maxLength={120}
            disabled={opening}
          />
          <Command.List
            aria-label="全局搜索结果"
            aria-busy={loading || opening}
          >
            {!needle ? (
              <p className="global-search-hint">
                消息仅在本机检索，不发送给模型。↑↓ 选择，Enter 打开，Esc 关闭。
              </p>
            ) : null}
            {local.agents.length ? (
              <Command.Group heading="成员">
                {local.agents.map((agent) => (
                  <Command.Item
                    key={agent.id}
                    value={`agent:${agent.id}`}
                    disabled={opening}
                    onSelect={() => void choose(() => onAgent(agent))}
                  >
                    <strong>{agent.name}</strong>
                    <small>
                      {agent.archivedAt ? '已归档 · ' : ''}
                      {agent.headline}
                    </small>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {local.projects.length ? (
              <Command.Group heading="项目">
                {local.projects.map((project) => (
                  <Command.Item
                    key={project.id}
                    value={`project:${project.id}`}
                    disabled={opening}
                    onSelect={() => void choose(() => onProject(project))}
                  >
                    <strong>{project.title}</strong>
                    <small>
                      {project.status === 'archived'
                        ? '已归档 · 打开历史'
                        : project.status === 'awaiting_user'
                          ? '等待你的反馈'
                          : '进行中'}
                    </small>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {messages.length ? (
              <Command.Group
                heading={
                  messages.length === 12
                    ? '聊天消息 · 最近 12 条，输入更具体的词可缩小范围'
                    : '聊天消息'
                }
              >
                {messages.map((message) => (
                  <Command.Item
                    key={message.id}
                    value={`message:${message.id}`}
                    disabled={opening}
                    onSelect={() => void choose(() => onMessage(message))}
                  >
                    <span className="global-search-source">
                      <strong>{sourceTitle(message)}</strong>
                      <time>
                        {new Date(message.createdAt).toLocaleDateString(
                          'zh-CN',
                        )}
                      </time>
                    </span>
                    <small>
                      {message.sender}
                      {message.forwarded ? ' · 转发内容' : ''}
                    </small>
                    <span className="global-search-excerpt">
                      {message.content}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {loading ? (
              <p role="status" className="global-search-hint">
                正在搜索消息…
              </p>
            ) : null}
            {needle && !loading && !error && !hasResults ? (
              <p role="status" className="global-search-hint">
                没有找到“{needle}”。可以换个词再试。
              </p>
            ) : null}
          </Command.List>
        </Command>
        {error ? (
          <p role="alert" className="global-search-error">
            {error}{' '}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              重新搜索
            </button>
          </p>
        ) : null}
        {opening ? (
          <p role="status" className="global-search-hint">
            正在打开来源…
          </p>
        ) : null}
      </form>
    </div>
  );
}
