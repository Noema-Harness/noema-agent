# Windows sandbox helper

Noema packages a patched x64 helper for `@anthropic-ai/sandbox-runtime` 0.0.81. The stock helper denies metadata reads on parent directories, which makes Node's `fs.realpathSync(process.cwd())` fail for the repository workspace. Noema uses this helper in development and places it at `resources/srt-win/x64/srt-win.exe` in packaged builds. A missing helper is a hard error; Windows does not silently fall back to the unpatched binary.

## Provenance and changes

- Base: `anthropics/sandbox-runtime` tag `v0.0.81`, commit `c40cf14a65d025e3cd27f071f13a73c12b3b1f92`.
- Upstream change adapted: [PR #661](https://github.com/anthropics/sandbox-runtime/pull/661), commit `3cdc6e6d6e3dbde88b356f0069487258a6dde6f8`.
- Source patches: `0001-srt-0.0.81-ancestor-acl.patch` and `0002-srt-0.0.81-world-writable-volume-roots.patch`; apply in order and check against the pinned tag before building.
- The backport preserves 0.0.81's ACL ordering, state database and crash-recovery behavior. It adds a non-inheritable parent ACE for `FILE_READ_ATTRIBUTES | SYNCHRONIZE | FILE_TRAVERSE`; it does not grant directory listing, file contents, or write access on ancestors. The egress probe starts from `System32` so a project command does not need access to Noema's own launch directory.
- The binary is distributed under Apache-2.0; see `LICENSE`.

## Rebuild

In a clean checkout of the upstream repository:

```powershell
git checkout v0.0.81
git apply --check C:\path\to\noema\apps\desktop\vendor\srt-win\0001-srt-0.0.81-ancestor-acl.patch
git apply C:\path\to\noema\apps\desktop\vendor\srt-win\0001-srt-0.0.81-ancestor-acl.patch
git apply --check C:\path\to\noema\apps\desktop\vendor\srt-win\0002-srt-0.0.81-world-writable-volume-roots.patch
git apply C:\path\to\noema\apps\desktop\vendor\srt-win\0002-srt-0.0.81-world-writable-volume-roots.patch
cargo test --locked --manifest-path vendor/srt-win-src/Cargo.toml
cargo build --locked --release --manifest-path vendor/srt-win-src/Cargo.toml --bin srt-win
Copy-Item vendor/srt-win-src/target/release/srt-win.exe C:\path\to\noema\apps\desktop\vendor\srt-win\x64\srt-win.exe -Force
```

The current x64 binary SHA-256 is `E3B878903A16FB82C03F6C9F85AC8B85D1C0606AD97243217AD37E4C4386695A`. It was built with the Windows GNU target and passed 193 unit tests, 2 persistent-grant integration tests, and 5 security-descriptor matrix tests.

## Verification limit

The helper's install step scans mounted local volume roots and adds a sandbox-user-only deny where broad local principals have write access. Before each sandbox session, Noema runs `srt-win ambient ensure`: its fast path only checks current roots, and it requests elevation only if a new or drifted root needs repair. A failed or cancelled repair prevents the command from starting. The baseline Windows x64 suite passes 22/22 real-runner checks, including denial of an unapproved D-drive write and continued writes inside approved workspaces. A separate adversarial check confirmed that a protected descendant directory with an explicit `Everyone:F` DACL can bypass the volume-root deny and modify an unapproved sentinel (0/1 for this boundary). Therefore the helper currently does not enforce the full outside-workspace write contract; see ADR 0033 and Issue #112. Do not present this SRT backend as a complete adversarial sandbox.
