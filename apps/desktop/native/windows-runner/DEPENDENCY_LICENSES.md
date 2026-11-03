# Native runner dependency license inventory

Generated from `cargo metadata --locked --offline --format-version 1` for the checked-in `Cargo.lock` on 2026-11-02. This is a source dependency inventory, not yet a packaged third-party notices bundle.

| Package | Version | Declared license |
|---|---:|---|
| `serde` | 1.0.228 | MIT OR Apache-2.0 |
| `serde_core` | 1.0.228 | MIT OR Apache-2.0 |
| `serde_derive` | 1.0.228 | MIT OR Apache-2.0 |
| `serde_json` | 1.0.150 | MIT OR Apache-2.0 |
| `windows-sys` | 0.61.2 | MIT OR Apache-2.0 |
| `windows-link` | 0.2.1 | MIT OR Apache-2.0 |
| `proc-macro2` | 1.0.106 | MIT OR Apache-2.0 |
| `quote` | 1.0.45 | MIT OR Apache-2.0 |
| `syn` | 2.0.117 | MIT OR Apache-2.0 |
| `unicode-ident` | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| `itoa` | 1.0.18 | MIT OR Apache-2.0 |
| `memchr` | 2.8.0 | Unlicense OR MIT |
| `zmij` | 1.0.21 | MIT |

The native crate is private (`publish = false`) and has no independent license declaration; the Noema repository also does not provide a root license file. Resolve the product-level license/notice policy before packaging.

## Upstream-derived implementation

`src/path_identity.rs` adapts the local-drive translation and `OBJ_DONT_REPARSE` directory-open pattern from `openai/codex` `windows-sandbox-rs/src/no_reparse_dir.rs`, commit `67f0994b532b8740f14b5b738af7b7b2a915b1d6`, source SHA-256 `F93737803AA6BCA3485E873F444CFAD4184D67F7F12A694D2A85967C8B0957DE`. The fixed snapshot retains the Apache-2.0 license at `.work/references/codex-windows-sandbox-sources/metadata/LICENSE`; Noema's source is a narrower adaptation and does not copy the upstream module verbatim. Preserve this provenance and include required third-party notices in any package that distributes derived code.

`src/acl.rs` adapts the handle-based DACL merge/apply pattern from the same fixed Codex commit, source file `codex-rs/windows-sandbox-rs/src/acl.rs`, upstream source SHA-256 `2B4685CB4A3ED79E124C113B5DED7C4FCC6FD5456C7E44A73DF145D0FD25C666`. The Noema file SHA-256 at this checkpoint is `037E56E4A4230971C28A2FFE9BF42549A5B67E372B798BE4015D0495A7026478`; its delta adds strict local capability SID-shape validation, null/invalid/protected-DACL rejection, idempotent allow-ACE detection, deny-ACE rejection, fixed per-object inheritance behavior, and in-memory-only tests. It is not yet called by the runner or tested against a filesystem ACL. The fixed source snapshot is Apache-2.0; preserve its license and required notice if the adapted module is distributed.
