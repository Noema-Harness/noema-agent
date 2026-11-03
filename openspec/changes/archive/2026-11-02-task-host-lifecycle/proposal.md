# Task host lifecycle and recovery

## Why

Project work is owned by the main-process host, but its persisted recovery currently labels every unfinished task as `app_restarted`. A normal app exit, Windows session shutdown, and an unexpected process loss are different lifecycle events and need distinct, inspectable outcomes.

## What Changes

- Persist a constrained application-exit or system-shutdown intent and consume it during task recovery.
- Route Windows session end and explicit exit through the same bounded host shutdown owner.
- Preserve distinct task outcomes for application exit, system shutdown, and process crash while keeping uncertain side effects non-replayable.

## Scope

- Persist a small, allowlisted shutdown intent before the host begins an orderly app exit or Windows session shutdown.
- Keep the intent through an incomplete/forced shutdown; clear it only after services and stores close cleanly.
- On startup, recover active project tasks with a reason that distinguishes app exit, system shutdown, and unexpected process loss.
- Preserve the existing rule that active external side effects become outcome-unknown and are never automatically replayed.
- Keep a user-requested task stop distinct from host shutdown.
- Give shutdown and recovery diagnostics task identity and a safe reason code.

## Not in scope

- Resuming a process, provider request, or child command from its exact instruction pointer.
- Automatically retrying an interrupted task or rolling back workspace changes.
- Multi-hour durability testing or claiming that an operating-system shutdown was tested by a unit test.

## Design

The SocialChatStore remains the durable owner for task lifecycle facts. It stores a single pending host-shutdown intent with a constrained reason (`application_exit` or `system_shutdown`) and timestamp. Startup consumes the intent atomically while recovering active tasks. With no pending intent, recovery is classified as `process_crash`.

The host requests service shutdown and joins active work within the existing 12-second deadline. On Windows, `BrowserWindow`'s `query-session-end` event is the system-shutdown signal; the host uses the same bounded stop/drain path. A completed drain closes stores and exits. A timeout leaves the durable intent for next-start recovery and forces process exit. The user-visible delay remains bounded by the existing deadline.

Interrupted task status remains `interrupted`. Reason-specific error codes are `application_exit_incomplete`, `system_shutdown_incomplete`, or `process_crash`; manual stop remains `worker_interrupted`. Safe resume is allowed only through the existing checkpoint and unresolved-side-effect gate.

## Risks and limits

- Electron documents that preventing `query-session-end` delays Windows shutdown. The wait is bounded at 12 seconds, but actual Windows shutdown interaction remains for user acceptance.
- A sudden power loss or process termination before the intent transaction is durable is necessarily classified as `process_crash`.
- A shutdown request can race with a terminal task write. Recovery must update only rows still in an active status.
