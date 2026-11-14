# Design

## Runtime boundary

```
Noema product objects
  Profile / Room / Project / Task Card / Memory / Permission
        │
        ▼
Noema orchestration
  context assembly, assignment, review, delivery
        │
        ▼
DSH Headless  ── one run = one session
  agent loop / tools / commands / file edits
  history / tokenization / compaction
        │
        ▼
Run record
  steps / usage / evidence / workspace changes
```

Noema does not run a second model or tool loop. A DSH session is an execution
resource; it is never the identity of a project, card, room, or memory.

## Roles

| Role         | Reads                                           | Tools                                             | Workspace                    | Cannot                                          |
| ------------ | ----------------------------------------------- | ------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| `noema`      | personal memory, project summaries, cards, team | chat, memory, card, assignment, review, synthesis | none                         | shell, arbitrary file write, direct execution   |
| `specialist` | own domain memory, current project              | domain read, review, direct chat                  | project read-only by default | direct file execution without a card            |
| `executor`   | task card, workspace, evidence                  | DSH tools, commands, file edit                    | one bound workspace per run  | personal memory, social messages, team creation |
| `group-lead` | group room, member reports                      | coordination, assignment, synthesis               | none                         | member tool execution, direct file write        |

All four use the same DSH runtime and differ only by policy. A policy is fixed
before the run starts and is recorded with the run.

## Runtime distribution gate

A consumer install must not depend on a globally installed DSH or Node. The
resolver prefers a pinned runtime at `resources/dsh-runtime`:

```
dsh-runtime/
  node.exe
  node_modules/@deepseek-ai/dsh/lib/bin.js
  node_modules/@deepseek-ai/dsh/package.json
```

External `dsh.cmd` and Node remain a developer fallback only. The runtime is
staged into `apps/desktop/runtime/dsh-runtime` and included as an
`extraResource`. Verified on 2026-11-10 with the packaged app launched with
`PATH=C:\Windows\System32;C:\Windows` and no DSH/Node environment overrides:
task `ed893e69-a17f-4ba5-9ae1-0a338c08b68c` completed through the bundled
runtime and wrote a 10-byte `runtime-check.txt`. `where dsh` and `where node`
both failed under that PATH. Chat loops still require the model matrix.

DSH is DeepSeek-first, not DeepSeek-only. Before chat migration, verify at
least: ordinary conversation, one-tool turns, multi-tool turns, long context,
and tool-failure recovery across the supported model families. A runtime
adapter isolates Noema from DSH-specific tool and prompt behavior.

## Task card

A card is a durable, two-way work object:

- states: `draft`, `assigned`, `running`, `waiting_for_input`, `review`,
  `completed`, `failed`, `cancelled`;
- fields: goal, acceptance, workspace, assignee, run(s), messages, evidence;
- one card may be assigned to one executor or to a team;
- a team is a lead session plus member sessions sharing the card and workspace,
  not one giant session and not a second runtime;
- ordinary chat and read-only questions create no card.

Cards are created by Noema when work has an external side effect, deliverable,
audit, or continuation need. Message length is not the trigger.

## Migration phases

1. **Execution layer (this change)**: remove production `NoemaProjectExecutor`
   and command-mirror fallback; all SocialWork execution goes through DSH;
   quarantine legacy code and enforce the boundary in `source:check`.
2. **Noema chat**: move `RootAgent` and `SocialChatService` model loops to DSH
   profiles; remove direct provider loops from production.
3. **Specialist and group**: move specialist/group turns to DSH profiles; keep
   product behavior and tool permissions.
4. **Cleanup**: remove legacy checkpoints, old `agent_id='noema'` execution
   attribution, and dead fallback branches; migrate historical records read-only.

This change currently implements phase 1 and the bundled-runtime resolver
prerequisite. Later phases must not re-create a second runtime to preserve old
behavior.

## Failure behavior

- DSH unavailable: fail the run with a bounded reason; do not fall back.
- Policy mismatch: reject before process creation.
- Legacy import in production: fail `npm run source:check`.
- Existing historical runs: readable, but never resume through a legacy runtime.
