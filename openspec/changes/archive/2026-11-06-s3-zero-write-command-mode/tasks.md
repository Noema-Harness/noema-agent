## 1. Main-process policy and grants

- [x] 1.1 Add the explicit filesystem mode and policy version 3 to the shared JS command-policy contract.
- [x] 1.2 Compile current Social commands as read-only; reject external write grants in that mode before ACL work.
- [x] 1.3 Update capability planning to allow empty write roots only for read-only mode and preserve exact identity checks.
- [x] 1.4 Add and run compiler/grant/execution-service tests for read-only, explicit read-write, invalid mode, and write-grant denial.

## 2. Native admission and version contract

- [x] 2.1 Update Rust policy validation and verified ACL-grant admission for both explicit modes; add and run native policy tests.
- [x] 2.2 Update helper probe/version parsing and cross-language fixtures; assert policy version 3 while keeping transport version 8.
- [x] 2.3 Bind policy version 3 to the native package manifest and startup diagnostics; report stale helper policy as a typed readiness error.
- [x] 2.4 Run affected Node/Rust suites, formatting/type/source checks, and strict OpenSpec validation.

## 3. Windows enforcement evidence

- [x] 3.1 Run a real Windows AppContainer child with read-only policy: workspace read succeeds, workspace write is OS-denied, and no file or outside sentinel changes.
- [x] 3.2 Record sanitized evidence and keep Stage 3 open until S3-02–04 are also complete and the full stage gate passes.
