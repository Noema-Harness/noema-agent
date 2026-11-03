# Noema Windows runner

This native helper is the Windows command isolation boundary. It creates an ordinary AppContainer child directly from policy. The Electron command path remains fail-closed while ACL journaling, diagnostics, packaging, and target-machine acceptance remain incomplete.

## Current implementation

- The bounded JSON-line protocol is version 7. A command result reports whether the AppContainer child was resumed, so the main-process diagnostics can distinguish prelaunch denial from a child whose final result or cleanup is unknown. The `probe` operation reads the current AppContainer profile and WFP rule state, but deliberately reports `ready: false` and disables command capabilities until the remaining runner gates are complete.
- `reconcile_sandbox_setup` creates or resolves the fixed AppContainer profile with no network capabilities. If network rules are missing, a fixed, one-shot elevated worker asks Windows for UAC consent and can install only Noema's package-SID deny policy. The ordinary helper captures the package SID and initiating user SID before UAC; the worker verifies that package SID against the fixed Noema profile moniker, then grants the initiating user only `FWPM_ACTRL_READ` on Noema's exact provider/sublayer/filter objects, preserving the rest of each DACL. An ordinary post-elevation probe reads the complete policy back. If the worker exceeds its wait limit, the caller tries to terminate it and wait for exit; unconfirmed cleanup is reported as unknown. On packaged Squirrel uninstall, Noema first inspects the same fixed policy; only exact Noema-owned objects may be removed, and elevation is requested only when rules exist. A canceled or failed cleanup warns the user and continues uninstall, leaving restrictive rules untouched. Ordinary commands are never elevated.
- The WFP policy owns a persistent provider/sublayer and eight package-SID block filters covering IPv4/IPv6 connect, receive/accept, listen, and resource assignment ALE layers. Installation is transactional. Reconciliation adds only missing objects when the existing Noema objects still match; conflicting objects, access errors, or incomplete verification fail closed. Development checks use pure fixtures and injected transaction failures; they have not created an AppContainer profile or changed the machine WFP store.
- The execute path binds the package SID to the fixed profile name, compiles only the current request's read/write capability names, and prepares `CreateProcessW` with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` and `PROC_THREAD_ATTRIBUTE_JOB_LIST`. Windows assigns the suspended child to the kill-on-close Job during creation; the helper independently verifies membership before resuming it. This closes the orphan window between process creation and a later `AssignProcessToJobObject` call. The path also uses explicit standard handles, an allowlisted environment, bounded output readers, timeout cleanup, and typed unknown-outcome failures. It has not launched a real command.
- Before any child creation, native policy admission checks every filesystem root that receives a capability. Write roots are required to be a subset of read roots, so the scan covers both modes. Any hard link, reparse point, unsupported entry, scan bound, or query failure rejects the request. The ACL verification path repeats the scan before its ACL checks. The confirmed threat boundary trusts other processes running as the same Windows user; the scan does not lock the entire tree against those processes.
- ACL reconciliation and verification use verified no-reparse handles, per-root read/write grants, and a durable Electron journal. No real ACL mutation has been run as part of development. The current readiness probe prevents execute from reaching child creation.
- The implementation does not create a separate Windows account or retain the retired DPAPI credential, account-setup worker, restricted-token, or nested runner-pipe path. Elevated workers accept only fixed WFP setup or cleanup arguments.

## Build and local checks

```powershell
cargo check --locked --manifest-path apps/desktop/native/windows-runner/Cargo.toml --target x86_64-pc-windows-msvc
cargo test --locked --manifest-path apps/desktop/native/windows-runner/Cargo.toml --target x86_64-pc-windows-msvc
```

Do not treat a successful build or fixture suite as proof of Windows enforcement. Keep command readiness disabled until the remaining D3 target-machine gates and final user acceptance are complete.

### Opt-in target-machine process acceptance

The ignored `tests::windows_live_appcontainer_process_tree_acceptance` test exercises fixed commands against an already configured AppContainer: waiting for a descendant after the root exits, timeout termination with confirmed Job cleanup, simulated Noema Stop by terminating a helper process while its fixed AppContainer command is active, and a loopback network attempt. The Stop case checks a delayed marker in the AppContainer's own profile folder to detect a surviving child. The network case confirms the host can reach a temporary local listener, confirms `curl.exe` can execute inside the AppContainer, then checks that the same child cannot reach that listener. Together with a verified WFP policy probe, this accepts the combined network-deny boundary without attributing failure to WFP alone. The test first requires the configured Windows command security baseline, an existing Noema profile, and verified persistent WFP deny filters. It does not create the profile, apply ACLs, change WFP state, or open normal Agent command execution. Run it only during explicit target-machine acceptance:

```powershell
$env:NOEMA_RUN_WINDOWS_LIVE_ACCEPTANCE = '1'
cargo test --locked --manifest-path apps/desktop/native/windows-runner/Cargo.toml --target x86_64-pc-windows-msvc -- --ignored --exact tests::windows_live_appcontainer_process_tree_acceptance --nocapture
Remove-Item Env:NOEMA_RUN_WINDOWS_LIVE_ACCEPTANCE
```

The test is intentionally not run by ordinary CI. It has not been run on this target machine. WFP rule-loss recovery and uninstall cleanup remain separate acceptance checks; this probe does not claim those results.

## Source basis

- AppContainer profile and launch APIs: Microsoft [`CreateAppContainerProfile`](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createappcontainerprofile), [`DeriveAppContainerSidFromAppContainerName`](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-deriveappcontainersidfromappcontainername), [`GetAppContainerFolderPath`](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-getappcontainerfolderpath), and [Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).
- Fixed Codex source slices and provenance are recorded in `.work/planning/research/noema/CODEX_RUNNER_SOURCE_SLICE.md`.
- `acl.rs` adapts the fixed Codex `acl.rs` DACL merge pattern (`GetSecurityInfo` → `SetEntriesInAclW` → `SetSecurityInfo`) from commit `67f0994b532b8740f14b5b738af7b7b2a915b1d6`; upstream source SHA-256 `2B4685CB4A3ED79E124C113B5DED7C4FCC6FD5456C7E44A73DF145D0FD25C666`, current Noema source SHA-256 `9A476DE2997873F51DF10FA68EC7CCD6EE8F5282DB216866E13685CD9E78EAB2`. The snapshot is Apache-2.0; retain required notices when packaging derived code.
- `setup_mutex.rs` follows the fixed Codex setup mutex boundary, allows the current owner user and administrators to serialize setup, and treats an abandoned mutex as requiring reconciliation.
- The WFP call sequence follows Microsoft's engine, transaction, persistent-object, ALE package-ID, and provider-uninstall contracts: [WFP access control](https://learn.microsoft.com/en-us/windows/win32/fwp/access-control), [WFP object management](https://learn.microsoft.com/en-us/windows/win32/fwp/object-management), [ALE layers](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers), [filtering conditions by layer](https://learn.microsoft.com/en-us/windows/win32/fwp/filtering-conditions-available-at-each-filtering-layer), [uninstalling a provider](https://learn.microsoft.com/en-us/windows/win32/fwp/uninstalling-a-provider), and [`FwpmFilterDeleteByKey0`](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fwpmk/nf-fwpmk-fwpmfilterdeletebykey0).
- Policy path rules and hard-link limits are described in the active OpenSpec change `windows-native-runner-lifecycle`. The tree evidence digest uses Windows CNG SHA-256.
- Locked registry dependency license metadata: [`DEPENDENCY_LICENSES.md`](DEPENDENCY_LICENSES.md).
