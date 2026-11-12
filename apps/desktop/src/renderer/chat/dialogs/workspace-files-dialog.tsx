import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { NoemaButton } from '../../ui/noema-button';
import { NoemaOverlay } from '../../ui/noema-overlay';
import { Icon } from '../presentation';
import type {
  NoemaWorkspaceFileEntry,
  NoemaWorkspaceFilePreview,
  NoemaWorkspaceImagePreview,
  NoemaWorkspaceSearchResult,
} from '../../../shared/contracts/noema-bridge.d.ts';

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;
const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i;

export function WorkspaceFilesDialog({
  workspacePath,
  initialFile = null,
  onClose,
}: {
  workspacePath: string;
  initialFile?: string | null;
  onClose: () => void;
}) {
  const [relativePath, setRelativePath] = useState('');
  const [entries, setEntries] = useState<NoemaWorkspaceFileEntry[]>([]);
  const [preview, setPreview] = useState<NoemaWorkspaceFilePreview | null>(
    null,
  );
  const [image, setImage] = useState<NoemaWorkspaceImagePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] =
    useState<NoemaWorkspaceSearchResult | null>(null);
  const initialFileOpened = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setImage(null);
    void window.noema
      .listWorkspaceFiles({ workspacePath, relativePath })
      .then((listing) => {
        if (cancelled) return;
        setEntries(listing.entries);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setError(reason instanceof Error ? reason.message : '无法读取工作区。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, relativePath]);

  const readRelativePath = async (path: string, name: string) => {
    setLoading(true);
    setPreview(null);
    setImage(null);
    try {
      if (IMAGE_EXTENSIONS.test(name)) {
        const nextImage = await window.noema.readWorkspaceImage({
          workspacePath,
          relativePath: path,
        });
        setImage(nextImage);
      } else {
        const file = await window.noema.readWorkspaceFile({
          workspacePath,
          relativePath: path,
        });
        setPreview(file);
      }
      setError(null);
    } catch (reason) {
      setPreview(null);
      setImage(null);
      setError(reason instanceof Error ? reason.message : '无法读取文件。');
    } finally {
      setLoading(false);
    }
  };

  const openFile = async (entry: NoemaWorkspaceFileEntry) => {
    if (entry.kind === 'directory') {
      setSearchResult(null);
      setRelativePath(entry.relativePath);
      return;
    }
    await readRelativePath(entry.relativePath, entry.name);
  };

  useEffect(() => {
    if (!initialFile || initialFileOpened.current) return;
    initialFileOpened.current = true;
    void readRelativePath(
      initialFile,
      initialFile.slice(initialFile.lastIndexOf('/') + 1),
    );
    // The initial path is supplied once by the execution card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const parentPath = relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/'))
    : '';

  const openFolder = async () => {
    try {
      await window.noema.openWorkspaceFolder({ workspacePath });
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '无法打开工作区文件夹。',
      );
    }
  };

  const search = async () => {
    const term = query.trim();
    if (!term) {
      setSearchResult(null);
      return;
    }
    setSearching(true);
    try {
      const result = await window.noema.searchWorkspaceFiles({
        workspacePath,
        query: term,
      });
      setSearchResult(result);
      setError(null);
    } catch (reason) {
      setSearchResult(null);
      setError(reason instanceof Error ? reason.message : '无法搜索工作区。');
    } finally {
      setSearching(false);
    }
  };

  const openMatch = (relativePath: string) => {
    const name = relativePath.split('/').pop() ?? relativePath;
    void openFile({ name, kind: 'file', relativePath });
  };

  return (
    <NoemaOverlay isOpen onClose={onClose} canEscapeKeyClose>
      <section
        className="social-dialog workspace-files-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-files-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="workspace-files-title">工作区文件</h2>
            <p title={workspacePath}>{workspacePath}</p>
          </div>
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            <Icon name="close" />
          </NoemaButton>
        </div>

        <div className="workspace-files-path">
          <NoemaButton
            className="secondary"
            type="button"
            disabled={!relativePath}
            onClick={() => {
              setSearchResult(null);
              setRelativePath(parentPath);
              setPreview(null);
            }}
          >
            上一级
          </NoemaButton>
          <code>{relativePath || '根目录'}</code>
          <NoemaButton
            className="secondary workspace-files-open"
            type="button"
            onClick={() => void openFolder()}
          >
            打开文件夹
          </NoemaButton>
        </div>

        <div className="workspace-files-search">
          <input
            type="search"
            aria-label="在工作区中搜索"
            placeholder="搜索文件名或内容"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!event.target.value.trim()) setSearchResult(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search();
            }}
          />
          <NoemaButton
            className="secondary"
            type="button"
            disabled={searching || !query.trim()}
            onClick={() => void search()}
          >
            {searching ? '搜索中…' : '搜索'}
          </NoemaButton>
          {searchResult ? (
            <NoemaButton
              className="secondary"
              type="button"
              onClick={() => {
                setSearchResult(null);
                setQuery('');
              }}
            >
              清除
            </NoemaButton>
          ) : null}
        </div>

        {error ? <p className="dialog-error">{error}</p> : null}

        <div className="workspace-files-body">
          <div
            className="workspace-files-list"
            role="list"
            aria-label={searchResult ? '搜索结果' : '文件列表'}
          >
            {searchResult ? (
              <>
                {searching ? <p>正在搜索…</p> : null}
                {!searching && searchResult.matches.length === 0 ? (
                  <p>没有找到匹配内容。</p>
                ) : null}
                {!searching
                  ? searchResult.matches.map((match, index) => (
                      <NoemaButton
                        key={`${match.relativePath}:${match.kind}:${match.line}:${index}`}
                        className="workspace-file-row workspace-file-match"
                        type="button"
                        onClick={() => openMatch(match.relativePath)}
                      >
                        <span aria-hidden>
                          {match.kind === 'name' ? '·' : '¶'}
                        </span>
                        <span className="workspace-file-match-copy">
                          <strong title={match.relativePath}>
                            {match.relativePath}
                          </strong>
                          <small>
                            {match.kind === 'name'
                              ? '文件名匹配'
                              : `第 ${match.line} 行 · ${match.excerpt}`}
                          </small>
                        </span>
                      </NoemaButton>
                    ))
                  : null}
                {searchResult.truncated ? <p>结果过多，已截断。</p> : null}
              </>
            ) : (
              <>
                {loading && !entries.length ? <p>正在读取…</p> : null}
                {!loading && !entries.length ? <p>这个文件夹是空的。</p> : null}
                {entries.map((entry) => (
                  <NoemaButton
                    key={entry.relativePath}
                    className="workspace-file-row"
                    type="button"
                    onClick={() => void openFile(entry)}
                  >
                    <span aria-hidden>
                      {entry.kind === 'directory' ? '▸' : '·'}
                    </span>
                    <span title={entry.name}>{entry.name}</span>
                  </NoemaButton>
                ))}
              </>
            )}
          </div>
          <div className="workspace-file-preview">
            {image ? (
              <>
                <div className="workspace-file-preview-head">
                  <code title={image.relativePath}>{image.relativePath}</code>
                  <span>{image.size} 字节</span>
                </div>
                <img
                  className="workspace-file-image"
                  src={`data:${image.mime};base64,${image.dataBase64}`}
                  alt={image.relativePath}
                />
              </>
            ) : preview ? (
              <>
                <div className="workspace-file-preview-head">
                  <code title={preview.relativePath}>
                    {preview.relativePath}
                  </code>
                  <span>{preview.size} 字节</span>
                </div>
                {MARKDOWN_EXTENSIONS.test(preview.relativePath) ? (
                  <div className="workspace-file-markdown">
                    <ReactMarkdown>{preview.content}</ReactMarkdown>
                  </div>
                ) : (
                  <pre>{preview.content}</pre>
                )}
              </>
            ) : (
              <p>选择一个文件查看内容。</p>
            )}
          </div>
        </div>
      </section>
    </NoemaOverlay>
  );
}
