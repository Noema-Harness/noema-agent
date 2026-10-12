# Noema — M1 interface hypothesis

Status: assistant-selected prototype direction under the user's delegated Noema design authority. It is not a user-approved brand system or permanent product specification.

## Previous hypothesis — rejected as a differentiator

The first prototype centered on an evidence margin beside chat. Research found that ChatGPT already exposes personalization sources and correction/removal, while Open WebUI, LibreChat, and Letta cover overlapping memory, model-switching, persistent identity, and multi-provider workflows. This interaction can remain a useful component, but it cannot justify Noema's independent existence. Do not treat the old prototype's memory panel as a durable visual or product decision.

## Current design thesis

Test one concrete interruption: a user reaches a quota or capability limit in one coding agent and needs to continue the same task in another. Keep the Noema conversation as the user's continuous thread. Distinguish (a) switching the model for another chat turn, which can carry the visible conversation, from (b) handing work to a specialized coding harness, which has its own native session, workspace, tools and execution trace. Before the second action, show a reviewable transfer packet and state plainly what is and is not carried. On return, attach the external result to the Noema thread without claiming that the external native transcript became the same session.

## Why this direction

Multi-model chat and personal memory already have mature alternatives. The less-covered friction in the user's stated work is moving between a chat/model frontend and a full coding harness while preserving the task's human-facing thread. Codex app-server and DSH expose resumable native sessions, but those sessions own different runtime state. The prototype tests whether Noema's incremental value could be the honest, low-friction handoff between those native sessions—not an impossible promise to merge them.

## Composition and behavior

- Keep the conversation itself central. A handoff appears inline at the point where the user is changing execution surfaces; do not build a separate global jobs dashboard.
- Present model switching and harness handoff as distinct actions. For model switching, state that the visible thread context is continued but tool capabilities depend on the target model. For harness handoff, show a proposed task packet, the destination's new/resumed native session, and explicit non-transferable state.
- Let the user inspect and edit the task/constraints, deselect optional context, proceed, defer, or cancel. If the destination cannot start, keep the Noema thread intact and offer retry/another destination without claiming work occurred.
- When an external agent returns, label its origin and native session, distinguish raw result from Noema's response, and let the user continue in Noema.
- Use the original-source/memory controls only as a subordinate supporting pattern when relevant; do not make them the hero.
- Motion may show handoff state transitions; it must never imply that a session was resumed, a tool ran, or a living agent acted unless that actually happened.

## Quality floor

The task, source, and current state are immediately legible. Controls have direct labels, feedback, keyboard focus, and a reversible path where possible. The rendered screen is checked at its target desktop dimensions and at a narrow width. Copy must not claim a real model, memory store, or provider portability before those capabilities exist.

## What remains open

This hypothesis does not settle Noema's final navigation, visual identity, memory architecture, autonomous behavior, or whether a central human-facing thread plus honest harness handoffs is enough to justify a standalone application. Open WebUI already switches models in one conversation; DSH's own plugin architecture can relay external sessions; Codex app-server supports native resume. Revisit whether Noema adds enough above those combinations after the runnable flow and direct comparison. Do not generalize one screen into a full design system.
