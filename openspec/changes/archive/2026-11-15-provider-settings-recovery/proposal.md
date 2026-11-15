# Proposal

## Why

Provider credentials can be saved while the remote service is unavailable, but the settings dialog closes and the user has no direct way to retry the model-list check with the saved credential. Keep the result and recovery action beside the connection controls so the user can correct the address, replace the key, or retry without copying secrets elsewhere.

## What Changes

- Add a user-triggered model-list recheck to configured provider settings.
- Keep provider settings open when validation or connectivity fails, with an announced inline result and a clear retry/edit path.
- Never repopulate a stored credential into the renderer; replacement inputs remain empty and masked.
- Check model status, key field privacy, and 420px dialog reachability in the existing isolated renderer probe.

## Capabilities

### New Capabilities

- `model-provider-settings`: user-visible provider configuration, connection recheck, model selection, and credential-safe recovery.

### Modified Capabilities

None.

## Impact

- `apps/desktop/src/renderer/chat/use-social-chat-controller.tsx`
- `apps/desktop/src/renderer/settings/partner-settings-dialog.tsx`
- provider settings styles and Electron model-availability probes
- No IPC or persistence contract changes; reuse existing `refreshModels` and encrypted credential storage.

---

## 归档说明（2026-11-15）

本变更已关闭，不再作为活动计划：剩余任务要么已由后续交付覆盖，要么已被新决定替代（见 `docs/DECISIONS.md` 与 `docs/STATUS.md`），规格增量未合并进 `openspec/specs`。需要继续时按新变更重新立项，不要恢复旧任务表。
