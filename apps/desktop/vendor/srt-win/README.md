# Retired Windows helper reference

This directory is retained as an audit record for the retired SRT Windows backend. Noema does not invoke or package this helper, does not install its sandbox account, and does not use it as a fallback. Windows project commands use the Noema native runner resource defined by the current execution code and Forge package hook.

The previous integration was disabled because its filesystem policy did not prove the required outside-workspace boundary. The old binary and patches are historical reference only; their presence does not indicate that Windows command execution is enabled.

## Provenance

- Base: `anthropics/sandbox-runtime` tag `v0.0.81`, commit `c40cf14a65d025e3cd27f071f13a73c12b3b1f92`.
- Adapted upstream change: PR #661, commit `3cdc6e6d6e3dbde88b356f0069487258a6dde6f8`.
- Local changes: `0001-srt-0.0.81-ancestor-acl.patch` and `0002-srt-0.0.81-world-writable-volume-roots.patch`.
- License: Apache-2.0; see `LICENSE`.

Do not use these artifacts to restore the retired backend. Any future reconsideration requires a fresh source review and an explicit product/architecture decision.
