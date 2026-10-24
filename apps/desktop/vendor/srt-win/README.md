# Windows sandbox helper

Noema packages a patched x64 helper for `@anthropic-ai/sandbox-runtime` 0.0.81. The stock helper denies metadata reads on parent directories, which makes Node's `fs.realpathSync(process.cwd())` fail for the repository workspace. Noema uses this helper in development and places it at `resources/srt-win/x64/srt-win.exe` in packaged builds. A missing helper is a hard error; Windows does not silently fall back to the unpatched binary.

## Provenance and changes

- Base: `anthropics/sandbox-runtime` tag `v0.0.81`, commit `c40cf14a65d025e3cd27f071f13a73c12b3b1f92`.
- Upstream change adapted: [PR #661](https://github.com/anthropics/sandbox-runtime/pull/661), commit `3cdc6e6d6e3dbde88b356f0069487258a6dde6f8`.
- Source patch: `0001-srt-0.0.81-ancestor-acl.patch`.
- The backport preserves 0.0.81's ACL ordering, state database and crash-recovery behavior. It adds a non-inheritable parent ACE for `FILE_READ_ATTRIBUTES | SYNCHRONIZE | FILE_TRAVERSE`; it does not grant directory listing, file contents, or write access on ancestors. The egress probe starts from `System32` so a project command does not need access to Noema's own launch directory.
- The binary is distributed under Apache-2.0; see `LICENSE`.

## Rebuild

In a clean checkout of the upstream repository:

```powershell
git checkout v0.0.81
git am C:\path\to\noema\apps\desktop\vendor\srt-win\0001-srt-0.0.81-ancestor-acl.patch
cargo test --locked --manifest-path vendor/srt-win-src/Cargo.toml
cargo build --locked --release --manifest-path vendor/srt-win-src/Cargo.toml --bin srt-win
Copy-Item vendor/srt-win-src/target/release/srt-win.exe C:\path\to\noema\apps\desktop\vendor\srt-win\x64\srt-win.exe -Force
```

The current x64 binary SHA-256 is `4F902CB4F62C0231F140844FFAB4F6C8F12024FB887A0748E524929708C6C86C`. It was built with the Windows GNU target and passed 192 unit tests, 2 persistent-grant integration tests, and 5 security-descriptor matrix tests.

## Verification limit

The rebuilt helper succeeds in Noema's real command wrapper for a repo-root workspace and fixes the stock helper's parent-directory `EPERM`. The machine's Codex host applies its own inherited deny ACL to nested scratch directories, and the command tool blocks writes outside its workspace. Therefore these checks do not yet prove behavior on an ordinary external workspace or prove the outside-write denial boundary. Do not treat this artifact as fully accepted until that end-to-end boundary check runs in a supported environment.
