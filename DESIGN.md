# Noema — M1 interface and visual hypothesis

Status: assistant-selected prototype direction under the user's delegated Noema design authority. It is not a user-approved brand system or permanent product specification.

## Previous hypothesis — rejected as a differentiator

The first prototype centered on an evidence margin beside chat. Research found that ChatGPT already exposes personalization sources and correction/removal, while Open WebUI, LibreChat, and Letta cover overlapping memory, model-switching, persistent identity, and multi-provider workflows. This interaction can remain a useful component, but it cannot justify Noema's independent existence. Do not treat the old prototype's memory panel as a durable visual or product decision.

## Current design thesis

The user has already specified an important behavior: Noema's primary dialogue should not be occupied by a long-running coding task. Noema may start a specialist in the background, keep the user-facing conversation available, and receive the result as a system event; if Noema is busy, the event waits for a safe boundary, while the user can interrupt the worker at any time. This behavior is now implemented with a real optional DSH headless worker: Noema retains the root conversation while DSH owns its native session, workspace, tools, and execution trace. Noema can switch its own response model without changing the worker. On task completion, a sourced event returns to the main conversation and Noema follows up. This proves the mechanics, not that this is a sufficiently distinctive or daily-worthy product.

The current live shell is useful as a functional baseline but is not an accepted visual identity. The single conversation canvas now includes a sourced worker event, workspace consent/selection, task state, stop/continuation controls, and a composer that remains available during background execution. These make the tested temporal relationship visible, but the surface still does not express Noema's individual identity. Retain behavior that passed the real DSH flow; continue to treat palette, typography, and layout as open design hypotheses.

## Why this direction

Multi-model chat, editable memory, and even Codex/Claude execution inside DSH have mature or emerging alternatives. Relay's DSH plugins show that a coding workbench can import and continue native Codex threads, and can host multiple execution backends. The possible Noema increment is not another unified coding workspace: it is a distinct, persistent root-agent conversation that stays available across those background executions and across non-coding dialogue. The real DSH flow tests one half of this distinction; it does not yet carry an existing Codex thread into Noema, nor prove users need a separate app for it.

## Composition and behavior

- Keep Noema's primary conversation central and independent from worker lifecycle; do not turn each worker task into a new user-facing primary chat.
- Show the Noema dialogue model separately from the already running worker's harness. Changing the former must not alter the latter.
- When the user's instruction is clear, start the worker without an extra confirmation step. Keep the sent context inspectable; allow task-scoped follow-up or stop while it runs. If the destination fails, preserve the main dialogue and handoff record and offer retry/another target.
- On completion, return a clearly sourced system event to the main conversation. Distinguish worker facts/tool output from Noema's interpretation; do not silently inject raw logs as if they were Noema's own thought.
- Existing Codex work can now enter this same chronology as a read-only source event: inspect a thread, preview the exact eligible visible text, then explicitly import a local snapshot. Reasoning/tool/session state stays in Codex; a separate native disclosure gates the first FreeLLMAPI request that includes the snapshot. Removal stops later inclusion but cannot retract prior upstream transmission.
- If the destination fails, preserve the main dialogue and handoff record so the user can retry or change target.
- Use the original-source/memory controls only as a subordinate supporting pattern when relevant; do not make them the hero.
- Motion may show handoff state transitions; it must never imply that a session was resumed, a tool ran, or a living agent acted unless that actually happened.

## Visual direction hypothesis

Noema's visual signature should come from its real temporal structure, not an arbitrary metaphor or a rarer palette: one continuing conversation, parallel execution that does not occupy it, and a sourced return that re-enters that same conversation. The first composition to explore is a full, readable conversational canvas with a compact, contextual activity rail attached to the task that created it. Expand the rail to inspect or steer; let it recede when nothing is running. When a result returns, show its origin and timing in the conversation's chronology, then distinguish Noema's response from the worker's report. The hierarchy should make these relationships easier to understand than a permanently open operations panel does.

This is an assistant-selected hypothesis, not a confirmed brand system. It does not yet choose light/dark mode, colors, fonts, component library, or a motion-intensity score. Decide those from the Chinese-first desktop use scene and the first real model/worker flow, then inspect them in the rendered app. Do not inherit a palette, rounded-card kit, font pairing, or layout preset merely because a design skill ranks it highly.

## Design-method synthesis

Design-enhancement methods solve different problems; combining their outputs indiscriminately would make a larger template, not a more original product:

- Anthropic Frontend Design grounds choices in subject matter and asks for a brief-specific thesis; “be distinctive” still needs a concrete product mechanism or it can produce arbitrary novelty.
- Impeccable contributes bounded critique, interaction polish, and a quality floor; its detector catches repeated tells but cannot certify Noema's point of view.
- Taste-Skill is aimed at landing pages and portfolios, not daily desktop product UI. Its anti-default examples are useful reminders, while numeric variance/motion/density dials can create false precision and a recognizable recipe.
- UI/UX Pro Max retrieves categorized patterns, palettes, and stack advice quickly; matching a product category ranks candidates, not their fit to Noema.
- Microsoft's frontend review emphasizes task clarity, craft, trust, and accessibility. Game UI guidance adds a useful outside-domain lesson: preserve the space where the primary activity happens and reveal secondary information contextually. Neither supplies Noema's visual identity.
- Design-system extraction/generation preserves consistency after a direction is chosen; it cannot prove product fit.
- Interface guidelines test semantics, keyboard access, responsive behavior, contrast, and recovery; compliance is the floor, not the signature.

Across them, the reliable common ground is that hierarchy encodes importance, visual states must match real states, controls need legible action/feedback/recovery, repeated patterns should behave consistently, and motion should explain a transition. Their anti-pattern lists are not objective aesthetic laws: accumulating bans narrows the output into a different shared template. Distinctiveness requires an additional product-specific test: could another agent app use this composition unchanged, and would removing a visual device make Noema's actual interaction harder to understand? A generic “yes” to the first or “no” to the second means the design still relies on borrowed style rather than Noema's mechanism.

## Rendered root-dialogue slice

At the actual 1226×797 Electron viewport, the first live root dialogue still reads as a familiar chat surface; it does not yet prove a distinctive Noema identity. Its useful product-specific structure is chronological: each user's turn and Noema's reply share one continuing thread. The live refinement removes duplicate timestamps and duplicate local-storage labels, removes a speaker stripe and nested reply rail that competed with the real time spine, and keeps model selection/status subordinate to the readable exchange. Resizing while following the latest message now preserves that position. These are evidence-backed hierarchy decisions, not a declaration that the final Noema visual system is solved.

The Codex import surface was inspected in the actual Electron window at 1226×797 and 680×560. The two-pane picker keeps the source list and exact text preview together; the imported event remains in the conversation chronology and expands to the text Noema actually stores. The narrow-window inspection caught and fixed a grid-row overflow that had allowed the preview to cover the disclosure/footer. This validates the local selection/preview/import/remove mechanics, not the value of Noema over DSH + Relay or the quality of responses after handoff.

## Quality floor

The task, source, and current state are immediately legible. Controls have direct labels, feedback, keyboard focus, and a reversible path where possible. The rendered screen is checked at its target desktop dimensions and at the app's minimum width. Copy must not claim a real model, memory store, or provider portability before those capabilities exist.

## What remains open

This hypothesis does not settle Noema's final navigation, visual identity, memory architecture, autonomous behavior, or whether a primary Noema dialogue plus background workers is enough to justify a standalone application. Open WebUI switches models in one conversation; DSH + Relay can host Codex/Claude backends and import Codex threads; Relay itself explores long-running tasks and event returns. Revisit whether the persistent root conversation across coding and non-coding life adds enough above those combinations after the runnable flow and direct comparison. Do not generalize one screen into a full design system.
