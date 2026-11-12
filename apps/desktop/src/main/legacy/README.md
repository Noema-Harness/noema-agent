# Legacy agent runtimes

This directory is for quarantined code that must not be imported by production
modules under `apps/desktop/src/main`.

- The old Noema project executor currently lives at
  `../execution/noema-project-executor.mjs`; it is still used as a fallback
  until the DSH Headless adapter becomes the sole execution runtime.
- New production code must use the DSH runtime and the product-layer services
  in `src/main/execution/` instead of that class.

`npm run source:check` rejects production imports from this directory.
