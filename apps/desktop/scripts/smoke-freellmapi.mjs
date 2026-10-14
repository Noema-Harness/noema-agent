// Probe the saved local gateway credential and catalog through localhost only.
// The smoke runner isolates the root database/DSH state and never sends a chat.
process.env.NOEMA_SMOKE_PROBE_FREELLMAPI = '1';
await import('./smoke.mjs');
