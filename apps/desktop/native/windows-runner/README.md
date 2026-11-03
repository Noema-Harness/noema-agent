# Noema Windows runner

This native helper is the Windows command isolation boundary. The native readiness probe reports the implemented capability set only when the supported Windows baseline and fixed AppContainer profile are live. Electron also requires durable setup state, diagnostics, and a clean ACL journal before a command can start; the native execute path repeats readiness and ACL checks immediately before child creation.

## Current implementation

- The bounded JSON-line protocol is version 8. Setup creates or resolves the fixed per-user AppContainer profile without elevation. The profile grants no network capabilities; Noema does not install persistent firewall/WFP rules, request UAC, or change machine firewall state.
- The setup state is owned by Electron main and becomes ready only after a fresh helper probe verifies the fixed profile SID. Version 3 setup records are reset because the current setup contract no longer includes the retired WFP evidence.
- The execute path binds the package SID to the fixed profile, compiles only the current request's read/write filesystem capability names, and creates `cmd.exe` with `CreateProcessW`, `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`, and `PROC_THREAD_ATTRIBUTE_JOB_LIST`. The child stays suspended until Job membership is independently checked. The restricted environment includes only the fixed allowlist plus `LOCALAPPDATA`, required by Windows while creating an AppContainer process.
- Process-tree completion and cleanup poll `QueryInformationJobObject` for the Job's active-process count. Waiting on a Job handle is not treated as a general normal-exit signal. Command path quoting strips the UTF-16 terminator before constructing the shell command line.
- Before child creation, native admission checks every filesystem root that receives a capability. Any hard link, reparse point, unsupported entry, scan bound, or query failure rejects the request. ACL verification repeats the scan. The threat boundary trusts other processes running as the same Windows user.
- Target-machine enforcement passed: a host positive control reached a temporary loopback listener while the same fixed `curl.exe` request from a zero-network-capability AppContainer could not; read-only and read/write filesystem capability ACLs respectively allowed only their intended access; a child without a filesystem capability could not write; and the process-tree probe verified descendant wait, timeout cleanup, and Stop with no residue.
- The Electron main-process path also passed a live temporary-root integration run: setup state was reconciled, the durable ACL journal was written before ACL changes, helper reconciliation and read-only evidence completed, and an isolated `cmd.exe` wrote the expected proof file. Temporary user data and workspace were removed after the run. This is target-machine integration evidence, not a substitute for using the packaged app on the user's ordinary workspace.
- The native probe now exposes the verified capabilities on a supported machine with a valid profile. Noema's app-owned setup state still must be initialized or repaired before commands are available. The diagnostics action does this without UAC; startup itself remains read-only.

## Build and local checks

```powershell
cargo fmt --manifest-path apps/desktop/native/windows-runner/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/native/windows-runner/Cargo.toml
cargo check --release --manifest-path apps/desktop/native/windows-runner/Cargo.toml
```

The opt-in network probe uses a temporary uniquely named AppContainer profile and removes it on exit. It does not request UAC or mutate WFP/ACL state:

```powershell
$env:NOEMA_RUN_APPCONTAINER_NETWORK_ISOLATION = '1'
cargo test --manifest-path apps/desktop/native/windows-runner/Cargo.toml windows_live_appcontainer_without_network_capability_denies_loopback -- --ignored --exact tests::windows_live_appcontainer_without_network_capability_denies_loopback --nocapture
Remove-Item Env:NOEMA_RUN_APPCONTAINER_NETWORK_ISOLATION
```

The ignored target-machine tests separately cover filesystem ACL enforcement, process-tree lifecycle, and zero-network-capability loopback denial. The Electron integration path composes user setup state, journal-before-ACL reconciliation, final ACL verification, and command execution against a disposable temporary workspace. These checks modify ACLs only under that temporary workspace, do not use WFP or UAC, and clean up the temporary data afterward.

## Source basis

- Windows AppContainer API and network-capability behavior: Microsoft [Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer) and [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation).
- Process environment and launch behavior: Microsoft [`CreateProcessW`](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw) and [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- Fixed Codex source slices and provenance are recorded in `.work/planning/research/noema/CODEX_RUNNER_SOURCE_SLICE.md`.
- `acl.rs` adapts the fixed Codex ACL merge pattern; preserve required Apache-2.0 notices when packaging derived code.
