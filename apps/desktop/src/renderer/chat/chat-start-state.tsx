/**
 * DORMANT (2026-11-12): no current renderer entrypoint.
 * Retained intentionally for a future start-state redesign; do not delete as dead code.
 * Revive only together with a real product entrypoint and acceptance case.
 */
import React from 'react';
import { NoemaButton } from '../ui/noema-button';
import { NoemaSpinner } from '../ui/noema-spinner';
import { Icon } from './presentation';

type Props = {
  providerReady: boolean;
  providerConfigured: boolean;
  checking: boolean;
  providerWarning: string | null;
  onConnectModel: () => void;
  onStartChat: () => void;
  onCreateProject: () => void;
};

export function ChatStartState({
  providerReady,
  providerConfigured,
  checking,
  providerWarning,
  onConnectModel,
  onStartChat,
  onCreateProject,
}: Props) {
  const unavailableHeading = providerConfigured
    ? '模型暂时不可用'
    : '先连接模型';
  const heading = checking
    ? '正在检查模型连接'
    : providerReady
      ? '从手边的一件事开始'
      : unavailableHeading;

  return (
    <section
      className="chat-start-state"
      aria-label="开始使用 Noema"
      aria-busy={checking}
    >
      <h1 aria-live={checking ? 'polite' : undefined}>
        {checking ? <NoemaSpinner size={22} /> : null}
        {heading}
      </h1>
      <p className="chat-start-description">
        {checking
          ? '确认连接状态后即可继续。'
          : providerReady
            ? '在下方写下要讨论或推进的事情。多步骤工作可以新建项目。'
            : providerConfigured
              ? (providerWarning ?? '打开模型设置查看连接状态并重试。')
              : '添加模型服务地址与密钥后，即可开始对话。'}
      </p>
      <div className="chat-start-actions">
        {providerReady ? (
          <>
            <NoemaButton
              type="button"
              className="chat-start-primary bp6-intent-primary"
              onClick={onStartChat}
            >
              开始对话 <Icon name="arrow" />
            </NoemaButton>
            <NoemaButton
              type="button"
              className="chat-start-secondary"
              onClick={onCreateProject}
            >
              <Icon name="plus" /> 新建项目
            </NoemaButton>
          </>
        ) : (
          <NoemaButton
            type="button"
            className="chat-start-primary bp6-intent-primary"
            onClick={onConnectModel}
          >
            {checking
              ? '查看模型设置'
              : providerConfigured
                ? '检查连接设置'
                : '配置模型'}{' '}
            <Icon name="arrow" />
          </NoemaButton>
        )}
      </div>
    </section>
  );
}
