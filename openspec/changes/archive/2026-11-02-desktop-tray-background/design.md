# Design

## Context

`main.ts` currently owns a singleton `mainWindow`, a single-instance lock, and one `before-quit` handler that shuts down RootAgent, SocialChatService and SocialWorkService. `window-all-closed` calls `app.quit()` on Windows. There is no tray owner or tray image asset. The active task and durable state remain owned by SocialWorkService/Executor/SocialChatStore; a BrowserWindow is only an observer and input surface.

Source comparison used for this change:

- DeepSeek Harness `DESKTOP_BACKGROUND_LIFECYCLE.md`: tray is a window return path while the host owns long-running services; explicit quit is separate. Its multi-process Host/update system is outside this change.
- Goose `DESKTOP_BACKGROUND_LIFECYCLE.md`: tray icon alone does not keep its Windows Agent backend alive; window close releases the process lease. This is a negative example for Noema's required behavior.
- Noema `CURRENT_STATE_RUNTIME.md`: current Windows close path exits Electron, while SocialChatStore marks active tasks interrupted on process restart. The planned change covers close-to-tray, not crash or power-loss recovery.

## Goals / Non-Goals

**Goals:**

- Make the Electron application lifetime longer than the main window lifetime.
- Keep tray, window, single-instance focus and quit policy in one main-process owner.
- Preserve the existing service and durable task owners; hide/show must not restart or transfer them.
- Make tray failure visible and diagnosable, and make shutdown status truthful and bounded.

**Non-Goals:**

- Do not add an OS service, login startup, scheduled restart, auto-update coordination, or crash recovery.
- Do not promise that active model calls or child processes resume after explicit quit, crash, system shutdown or power loss. B4 owns task shutdown/recovery coordination beyond this host boundary.
- Do not refactor the whole main process or change the current single-instance exceptions for smoke tests, tests, and installer lifecycle events.

## Decisions

### 1. Introduce a testable main-process lifecycle owner

Add a narrow `DesktopLifecycle` coordinator with injected Electron primitives, the window factory/accessor, quit function and diagnostic callback. It owns tray creation, close-to-hide, restore/focus, second-instance restore, tray teardown, and the quit-in-progress guard. The current `startNoema()` continues to construct services once; restoring a window calls only `createWindow()` when needed.

This keeps Electron event sequencing out of React and makes close/restore/quit/failure behavior testable without launching Windows shell UI. A broad application service container was considered and rejected because the current app has one main window and already has a clear main-process owner.

### 2. Build the tray icon from a bundled inline vector

No reusable tray or application icon asset exists in the checked-in source tree. Add a small monochrome PNG mark as a source-owned asset; load it through Electron `nativeImage` from the app root in development and `process.resourcesPath` in packaged builds. Do not depend on development-server URLs or a renderer screenshot. If the resource cannot be created or the Tray constructor throws, emit a safe error event and keep the main window visible; allow normal window close/quit rather than hiding with no return path.

### 3. Separate close, restore and quit intent

The main-window `close` event is prevented only while a working tray exists and the host is not quitting; the owner then hides the same BrowserWindow. Tray click/Open and `second-instance` restore that instance, unminimize it, show it, and focus it. Tray Exit calls `app.quit()`; the existing `before-quit` shutdown remains the sole service shutdown owner. An `isQuitting` guard lets shutdown destroy the window/tray without reentering close-to-hide.

The close handler records only lifecycle operation/status and the existing application execution ID. It does not capture window title, renderer text or filesystem paths.

### 4. Bound and report host shutdown

Keep the current service shutdown set, but run it under a documented bounded deadline. On settlement, close the root store and quit; if the deadline expires, record timeout and continue process exit without emitting success. Do not close the database first and then keep waiting on jobs that may still use it. B4 will separately refine stop intent, task outcome classification, child cleanup and restart semantics; this change does not claim those deeper task guarantees.

An async timeout cannot safely terminate arbitrary JavaScript work. The timeout bounds how long the Electron host waits before leaving; any late promise settlement is ignored for success reporting and the process is exiting. This remains a limitation to address with B4 owner-specific shutdown contracts.

### 5. Treat lifecycle diagnostics as observational

Use the existing `recordDiagnosticEvent` allowlist and application execution ID. Record `window.hidden`, `window.restored`, `tray.ready/error`, `exit.requested`, and shutdown start/completed/timeout. Catch diagnostic callback failures so they cannot block UI or host lifecycle.

## Risks / Trade-offs

- [Tray icon creation differs across Windows packaging contexts] → use a bundled source asset, unit-test failure behavior, and include packaged Windows smoke plus user notification-area inspection.
- [An async shutdown may settle after the deadline] → report timeout truthfully, avoid completion events after timeout, and keep B4 responsible for explicit task stop/outcome semantics.
- [Closing on a system shutdown or external process kill bypasses normal user flow] → do not describe close-to-tray as crash/OS-shutdown recovery; active task restart behavior remains governed by existing durable task recovery.
- [Window recreation could accidentally duplicate services] → keep service construction in `startNoema()` and test restore with a destroyed window calls only the window factory.

## Migration Plan

No persisted schema migration is needed. Add the tray source asset and lifecycle owner, wire it during `app.whenReady()` before showing the main window, and keep the change reversible by removing the owner/listeners and returning to current window-all-closed behavior. Runtime service and task stores remain unchanged.
