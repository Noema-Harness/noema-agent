# Windows sandbox helper

Noema packages a patched x64 helper for `@anthropic-ai/sandbox-runtime` 0.0.81. The stock helper denies metadata reads on parent directories, which makes Node's `fs.realpathSync(process.cwd())` fail for the repository workspace. Packaging places the helper at `resources/srt-win/x64/srt-win.exe`; a missing helper is a hard error. The product currently disables Windows project commands before sandbox initialization, so this binary's presence does not mean command execution is available.

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

The packaged x64 binary SHA-256 is `E3B878903A16FB82C03F6C9F85AC8B85D1C0606AD97243217AD37E4C4386695A`, rechecked on 2026-11-02. It was built with the Windows GNU target.

## Verification limit

The helper adds sandbox-user-only deny entries at volume roots. A previously reproduced protected descendant directory with an explicit `Everyone:F` DACL bypassed that inherited deny and allowed an unapproved write. The backend therefore does not enforce Noema's full outside-workspace contract. The current startup guard is in `src/main/execution/project-command-sandbox.mjs`, with regression coverage in `test/main/execution/project-command-sandbox.test.mjs`. Changing the development shell or finding this binary is not evidence that the isolation gap is resolved.
