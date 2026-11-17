import { useCallback, useEffect, useState } from 'react';
import { NoemaButton } from '../../ui/noema-button';
import { NoemaOverlay } from '../../ui/noema-overlay';
import type {
  NoemaSocialAgent,
  NoemaSocialAgentAsset,
  NoemaSocialAgentAssetRevision,
  NoemaSocialAgentAssetSummary,
  NoemaSocialProject,
} from '../../../shared/contracts/noema-bridge.d.ts';

const dateText = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const pathLabel = (path: string) => {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/u, '');
};

const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : '操作没有完成，请重试。';

/**
 * Read, withdraw and restore the experiences a specialist accumulated.
 *
 * The store owns revision semantics; this dialog only asks for the current
 * list, one asset with its history, and the two write operations.
 */
export function MemberAssetsDialog({
  agent,
  projects,
  onClose,
}: {
  agent: NoemaSocialAgent;
  projects: NoemaSocialProject[];
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<NoemaSocialAgentAssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<NoemaSocialAgentAsset | null>(null);
  const [revisions, setRevisions] = useState<NoemaSocialAgentAssetRevision[]>(
    [],
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const readOnly = Boolean(agent.archivedAt);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      setAssets(await window.noema.listSocialAgentAssets(agent.id));
      setError(null);
    } catch (reason) {
      setAssets([]);
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openAsset = useCallback(
    async (path: string) => {
      setOpenPath(path);
      setDetail(null);
      setRevisions([]);
      setPendingDelete(false);
      setDetailLoading(true);
      try {
        const [asset, history] = await Promise.all([
          window.noema.getSocialAgentAsset(agent.id, path),
          window.noema.listSocialAgentAssetRevisions(agent.id, path),
        ]);
        setDetail(asset);
        setRevisions(history);
        setError(null);
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setDetailLoading(false);
      }
    },
    [agent.id],
  );

  const removeAsset = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await window.noema.deleteSocialAgentAsset({
        agentId: agent.id,
        path: detail.path,
        expectedRevision: detail.revision,
      });
      setPendingDelete(false);
      setNotice('已删除，可从历史版本恢复。');
      setError(null);
      await loadList();
      await openAsset(detail.path);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const restoreRevision = async (revision: NoemaSocialAgentAssetRevision) => {
    setBusy(true);
    try {
      const restored = await window.noema.restoreSocialAgentAsset({
        agentId: agent.id,
        path: revision.path,
        revision: revision.revision,
        expectedRevision: detail?.revision ?? 0,
      });
      setNotice(`已恢复到修订 ${restored.revision}。`);
      setError(null);
      await loadList();
      await openAsset(revision.path);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = (asset: { sourceProjectId: string | null }): string => {
    if (!asset.sourceProjectId) return '手动维护';
    const project = projects.find(
      (candidate) => candidate.id === asset.sourceProjectId,
    );
    return project?.title ?? '项目已删除';
  };

  return (
    <NoemaOverlay isOpen onClose={onClose} canEscapeKeyClose>
      <section
        className="social-dialog member-assets-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-assets-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="member-assets-title">{agent.name} 的经历</h2>
            <p>
              {readOnly
                ? '成员已归档，经历只读。'
                : '项目复盘沉淀在这里，可以删除或从历史恢复。'}
            </p>
          </div>
        </div>

        {notice ? <p className="member-assets-notice">{notice}</p> : null}
        {error ? <p className="member-assets-error">{error}</p> : null}

        {loading ? <p className="member-assets-muted">正在读取…</p> : null}

        {!loading && !assets.length ? (
          <div className="core-empty">
            <strong>还没有经历</strong>
            <span>完成项目复盘后会出现在这里。</span>
          </div>
        ) : null}

        <ul className="member-assets-list">
          {assets.map((asset) => {
            const open = openPath === asset.path;
            return (
              <li className="member-assets-item" key={asset.path}>
                <button
                  className="member-assets-row"
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    void (open ? setOpenPath(null) : openAsset(asset.path))
                  }
                >
                  <span className="member-assets-copy">
                    <strong>
                      {pathLabel(asset.path)}
                      {asset.deleted ? (
                        <span className="member-assets-deleted">已删除</span>
                      ) : null}
                    </strong>
                    <small>
                      {asset.path} · 修订 {asset.revision}
                    </small>
                  </span>
                  <span className="member-assets-meta">
                    {sourceLabel(asset)} · {dateText(asset.createdAt)}
                  </span>
                  <span className="member-assets-toggle">
                    {open ? '收起' : asset.deleted ? '历史' : '查看'}
                  </span>
                </button>

                {open ? (
                  detailLoading ? (
                    <p className="member-assets-muted">正在读取…</p>
                  ) : (
                    <div className="member-assets-body">
                      {detail ? (
                        <pre className="member-assets-content">
                          {detail.content}
                        </pre>
                      ) : (
                        <p className="member-assets-muted">这条经历已删除。</p>
                      )}

                      {readOnly ? (
                        <p className="member-assets-muted">
                          已归档成员不能修改经历。
                        </p>
                      ) : pendingDelete ? (
                        <div className="member-assets-confirm">
                          <span>删除后可从历史版本恢复。</span>
                          <NoemaButton
                            className="secondary"
                            type="button"
                            onClick={() => setPendingDelete(false)}
                          >
                            取消
                          </NoemaButton>
                          <NoemaButton
                            type="button"
                            disabled={busy}
                            onClick={() => void removeAsset()}
                          >
                            删除
                          </NoemaButton>
                        </div>
                      ) : detail ? (
                        <div className="member-assets-actions">
                          <NoemaButton
                            className="secondary"
                            type="button"
                            disabled={busy}
                            onClick={() => setPendingDelete(true)}
                          >
                            删除这条经历
                          </NoemaButton>
                        </div>
                      ) : null}

                      <div className="member-assets-history">
                        <h3>版本历史</h3>
                        <ul>
                          {revisions.map((revision) => (
                            <li
                              key={revision.id}
                              className={
                                revision.isDeleted ? 'is-deleted' : undefined
                              }
                            >
                              <span>
                                修订 {revision.revision}
                                {revision.isDeleted ? ' · 已删除' : ''}
                              </span>
                              <small>
                                {revision.reason} ·{' '}
                                {dateText(revision.createdAt)}
                              </small>
                              {!revision.isDeleted &&
                              !readOnly &&
                              revision.revision !== detail?.revision ? (
                                <NoemaButton
                                  className="text-button"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void restoreRevision(revision)}
                                >
                                  恢复
                                </NoemaButton>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>

        <footer className="dialog-actions">
          <NoemaButton className="secondary" type="button" onClick={onClose}>
            关闭
          </NoemaButton>
        </footer>
      </section>
    </NoemaOverlay>
  );
}
