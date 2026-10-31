import React, { useEffect, useRef } from 'react';

export interface QuickCaptureDialogProps {
  open: boolean;
  value: string;
  shortcutLabel: string | null;
  shortcutRegistered: boolean | null;
  saving: boolean;
  saved: boolean;
  error: string;
  onChange(value: string): void;
  onSave(): void;
  onCancel(): void;
}

export function QuickCaptureDialog({
  open,
  value,
  shortcutLabel,
  shortcutRegistered,
  saving,
  saved,
  error,
  onChange,
  onSave,
  onCancel,
}: QuickCaptureDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      textareaRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="quick-capture-dialog"
      aria-labelledby="quick-capture-title"
      aria-describedby="quick-capture-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onCancel();
      }}
    >
      <form
        className="quick-capture-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="quick-capture-heading">
          <div>
            <h2 id="quick-capture-title">本机速记</h2>
            <p id="quick-capture-description">
              只保存在 Noema；不会发送给模型。
            </p>
          </div>
          {shortcutRegistered && shortcutLabel && <kbd>{shortcutLabel}</kbd>}
        </div>
        <label className="sr-only" htmlFor="quick-capture-input">
          记录一个想法
        </label>
        <textarea
          ref={textareaRef}
          id="quick-capture-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onSave();
            }
          }}
          placeholder="写下刚刚想到的事…"
          rows={5}
          maxLength={100_000}
          autoComplete="off"
          spellCheck
        />
        <p
          className={`quick-capture-status${error ? ' is-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error ||
            (saved
              ? '已保存在 Noema，本条没有发送给模型。'
              : '之后可在 Noema 时间线上继续讨论。')}
        </p>
        <div className="quick-capture-actions">
          <span>Esc 取消 · Ctrl+Enter 保存</span>
          <div>
            <button
              className="quick-capture-cancel"
              type="button"
              onClick={onCancel}
              disabled={saving}
            >
              取消
            </button>
            <button
              className="quick-capture-save"
              type="submit"
              disabled={!value.trim() || saving || saved}
            >
              {saving ? '正在保存…' : saved ? '已保存' : '保存到时间线'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
