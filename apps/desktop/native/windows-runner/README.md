# Noema Windows runner

This native helper is the Windows command isolation boundary. It creates an ordinary AppContainer child directly from policy. The Electron command path remains fail-closed while ACL journaling, diagnostics, packaging, and target-machine acceptance remain incomplete.

## Current implementation

- The bounded JSON-line protocol is version 6. A command result reports whether the AppContainer child was resumed, so the main-process diagnostics can distinguish prelaunch denial from a child whose final result or cleanup is unknown. The `probe` operation reads the current AppContainer profile and WFP rule state, but deliberately reports `ready: false` and disables command capabilities until the remaining runner gates are complete.
- `reconcile_sandbox_setup` creates or resolves the fixed AppContainer profile with no network capabilities. If network rules are missing, a fixed, one-shot elevated worker asks Windows for UAC consent and can install only Noema's package-SID deny policy; it receives no command or user-controlled policy over IPC. Ordinary commands are never elevated. A fresh unelevated probe reads back the resulting state before setup can commit ready.
- The WFP policy owns a persistent provider/sublayer and eight package-SID block filters covering IPv4/IPv6 connect, receive/accept, listen, and resource assignment ALE layers. Installation is transactional. Reconciliation adds only missing objects when the existing Noema objects still match; conflicting objects, access errors, or incomplete verification fail closed. Development checks use pure fixtures and injected transaction failures; they have not created an AppContainer profile or changed the machine WFP store.
- The execute path binds the package SID to the fixed profile name, compiles only the current request's read/write capability names, and prepares `CreateProcessW` with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`. It uses explicit standard handles, an allowlisted environment, a suspended child, a kill-on-close Job, bounded output readers, timeout cleanup, and typed unknown-outcome failures. It has not launched a real command.
- Before any child creation, native policy admission checks every filesystem root that receives a capability. Write roots are required to be a subset of read roots, so the scan covers both modes. Any hard link, reparse point, unsupported entry, scan bound, or query failure rejects the request. The ACL verification path repeats the scan before its ACL checks. The confirmed threat boundary trusts other processes running as the same Windows user; the scan does not lock the entire tree against those processes.
- ACL reconciliation and verification use verified no-reparse handles, per-root read/write grants, and a durable Electron journal. No real ACL mutation has been run as part of development. The current readiness probe prevents execute from reaching child creation.
- The implementation does not create a separate Windows account or retain the retired DPAPI credential, account-setup worker, restricted-token, or nested runner-pipe path. The current elevated worker is limited to fixed WFP setup.

## Build and local checks

```powershell
cargo check --locked --manifest-path apps/desktop/native/windows-runner/Cargo.toml --target x86_64-pc-windows-msvc
cargo test --locked --manifest-path apps/desktop/native/windows-runner/Cargo.toml --target x86_64-pc-windows-msvc
```

Do not treat a successful build or fixture suite as proof of Windows enforcement. Keep command readiness disabled until the remaining D3/D4 gates and target-machine acceptance are complete.

## Source basis

- AppContainer profile and launch APIs: Microsoft [`CreateAppContainerProfile`](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createappcontainerprofile), [`DeriveAppContainerSidFromAppContainerName`](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-deriveappcontainersidfromappcontainername), [`GetAppContainerFolderPath`](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-getappcontainerfolderpath), and [Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).
- Fixed Codex source slices and provenance are recorded in `.work/planning/research/noema/CODEX_RUNNER_SOURCE_SLICE.md`.
- `acl.rs` adapts the fixed Codex `acl.rs` DACL merge pattern (`GetSecurityInfo` → `SetEntriesInAclW` → `SetSecurityInfo`) from commit `67f0994b532b8740f14b5b738af7b7b2a915b1d6`; upstream source SHA-256 `2B4685CB4A3ED79E124C113B5DED7C4FCC6FD5456C7E44A73DF145D0FD25C666`, current Noema source SHA-256 `9A476DE2997873F51DF10FA68EC7CCD6EE8F5282DB216866E13685CD9E78EAB2`. The snapshot is Apache-2.0; retain required notices when packaging derived code.
- `setup_mutex.rs` follows the fixed Codex setup mutex boundary, allows the current owner user and administrators to serialize setup, and treats an abandoned mutex as requiring reconciliation.
- The WFP call sequence follows Microsoft's engine, transaction, persistent-object, and ALE package-ID contracts: [WFP access control](https://learn.microsoft.com/en-us/windows/win32/fwp/access-control), [WFP object management](https://learn.microsoft.com/en-us/windows/win32/fwp/object-management), [ALE layers](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers), and [filtering conditions by layer](https://learn.microsoft.com/en-us/windows/win32/fwp/filtering-conditions-available-at-each-filtering-layer).
- Policy path rules and hard-link limits are described in the active OpenSpec change `windows-native-runner-lifecycle`. The tree evidence digest uses Windows CNG SHA-256.
- Locked registry dependency license metadata: [`DEPENDENCY_LICENSES.md`](DEPENDENCY_LICENSES.md).
