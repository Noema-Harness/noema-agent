# Noema — M1 interface hypothesis

Status: assistant-selected prototype direction under the user's delegated Noema design authority. It is not a user-approved brand system or permanent product specification.

## Previous hypothesis — rejected as a differentiator

The first prototype centered on an evidence margin beside chat. Research found that ChatGPT already exposes personalization sources and correction/removal, while Open WebUI, LibreChat, and Letta cover overlapping memory, model-switching, persistent identity, and multi-provider workflows. This interaction can remain a useful component, but it cannot justify Noema's independent existence. Do not treat the old prototype's memory panel as a durable visual or product decision.

## Current design thesis

The user has already specified an important behavior: Noema's primary dialogue should not be occupied by a long-running coding task. Noema may start a specialist in the background, keep the user-facing conversation available, and receive the result as a system event; if Noema is busy, the event waits for a safe boundary, while the user can interrupt the worker at any time. The current prototype therefore tests a two-layer interaction: a persistent Noema conversation remains the human's place to think, while a small, inspectable background-task surface owns the external harness handoff. The worker has its own native session, workspace, tools, and execution trace. Noema can switch its own response model without changing the worker. On task completion, the event returns to the main conversation and Noema discusses what happened.

## Why this direction

Multi-model chat, editable memory, and even Codex/Claude execution inside DSH have mature or emerging alternatives. Relay's DSH plugins show that a coding workbench can import and continue native Codex threads, and can host multiple execution backends. The possible Noema increment is not another unified coding workspace: it is a distinct, persistent root-agent conversation that stays available across those background executions and across non-coding dialogue. The prototype tests that distinction; it does not yet prove users need a separate app for it.

## Composition and behavior

- Keep Noema's primary conversation central and independent from worker lifecycle; do not turn each worker task into a new user-facing primary chat.
- Show the Noema dialogue model separately from the already running worker's harness. Changing the former must not alter the latter.
- The user can continue speaking with Noema while the background task runs, add a task-scoped instruction, or stop the task. The task's accepted context is inspectable but does not masquerade as a shared transcript.
- On completion, return a clearly sourced system event to the main conversation. Distinguish worker facts/tool output from Noema's interpretation; do not silently inject raw logs as if they were Noema's own thought.
- If the destination fails, preserve the main dialogue and handoff record so the user can retry or change target.
- Use the original-source/memory controls only as a subordinate supporting pattern when relevant; do not make them the hero.
- Motion may show handoff state transitions; it must never imply that a session was resumed, a tool ran, or a living agent acted unless that actually happened.

## Quality floor

The task, source, and current state are immediately legible. Controls have direct labels, feedback, keyboard focus, and a reversible path where possible. The rendered screen is checked at its target desktop dimensions and at a narrow width. Copy must not claim a real model, memory store, or provider portability before those capabilities exist.

## What remains open

This hypothesis does not settle Noema's final navigation, visual identity, memory architecture, autonomous behavior, or whether a primary Noema dialogue plus background workers is enough to justify a standalone application. Open WebUI switches models in one conversation; DSH + Relay can host Codex/Claude backends and import Codex threads; Relay itself explores long-running tasks and event returns. Revisit whether the persistent root conversation across coding and non-coding life adds enough above those combinations after the runnable flow and direct comparison. Do not generalize one screen into a full design system.
