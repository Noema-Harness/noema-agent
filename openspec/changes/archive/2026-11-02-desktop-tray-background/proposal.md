# Proposal

## Why

Noema currently exits when its last window closes, which cuts off the same main-process services that own active work. The user explicitly expects closing the window to leave Noema running in the Windows notification area, with a distinct and intentional exit path.

## What Changes

- Keep a single application-owned tray icon for the lifetime of the desktop process, with Open and Exit actions.
- Make closing the main window hide it while the tray is available; reopening from the tray or starting a second instance restores and focuses the same window and session.
- Route explicit tray Exit through the existing main-process shutdown path, with bounded completion and local lifecycle diagnostics.
- If tray creation fails, record the failure and preserve a visible, usable window; do not silently hide the only way to return.
- Add lifecycle regression checks and a packaged Windows smoke/visual acceptance path. Do not configure login startup or claim crash/OS-shutdown task recovery.

## Capabilities

### New Capabilities

- `desktop-host-lifecycle`: desktop window, tray, single-instance, and explicit application-exit behavior.

### Modified Capabilities

None.

## Impact

- Electron main-process window creation, single-instance handling, application quit, and diagnostics event recording.
- New testable desktop lifecycle owner and focused tests; Windows tray icon asset/rendering and packaged smoke behavior.
- No new runtime dependency, provider request, or change to SocialWork task persistence ownership.
