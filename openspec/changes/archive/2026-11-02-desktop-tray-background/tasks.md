# Tasks

## 1. Host lifecycle owner

- [x] 1.1 Add an injectable desktop lifecycle coordinator for tray initialization, close-to-hide, restore/focus, second-instance handling and teardown; unit-test event ordering, single-instance restoration and no duplicate service creation.
- [x] 1.2 Add a bundled tray icon resource and resilient initialization; test missing/invalid icon behavior and confirm failure leaves the window visible and records a safe diagnostic.

## 2. Main-process integration

- [x] 2.1 Wire tray and lifecycle ownership into `main.ts`; verify hide/restore and explicit tray exit use the same main window and existing shutdown owner.
- [x] 2.2 Bound shutdown waiting and record requested/started/completed/timeout events without sensitive fields; test success, timeout and diagnostic-sink failure.

## 3. User-visible behavior and integrated verification

- [x] 3.1 Add an isolated Electron lifecycle smoke probe for close-to-hide, tray restore, single-instance restore and explicit exit; run typecheck, source:check and focused lifecycle tests.
- [x] 3.2 Run Windows packaged smoke/visual inspection where supported; verify tray error path, diagnostics event sequence, no task cancellation on hide and no real model request.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived `desktop-host-lifecycle` spec.
