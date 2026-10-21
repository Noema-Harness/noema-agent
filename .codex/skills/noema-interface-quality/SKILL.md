---
name: noema-interface-quality
description: Design or materially change user-visible Noema screens, flows, or components. Use before UI implementation and again for visual verification; not for backend-only changes or copy-only edits.
---

# Noema Interface Quality

## Establish the design question

Read the active Issue, `docs/design/chat-redesign-brief.md` and only the product/architecture records relevant to this change. Check whether the work is exploring a product direction, defining a visual language, or improving an accepted flow. These need different evidence.

Noema is a basic demo. Its current screens and features document implementation, not a finished product or a source of proven differentiation. Start product proposals from a concrete user situation, current alternatives and an intended improvement. Use the demo later to estimate reuse, gaps and removal cost. Do not turn context isolation into a selling point, rebrand prompt-based memory as a novel relationship model, or infer that another existing feature must contain the answer when a proposal is rejected.

Develop product purpose, interaction and visual identity together while using distinct evidence to judge each. For an immature product, surface missing user outcomes and capabilities rather than designing only around existing screens. Tie composition, density and character to expected use; visual studies can expose product gaps. Familiar functionality can have distinctive visual language, but aesthetic success does not establish product fit or value. Compare alternatives on the same user problem and outcome, not an engineering invariant against a feature.

## Form a concrete proposal

For open-ended redesign, or after feedback rejects a structure as generic, do not start a polished screen. First locate the failure in the user problem, capability lifecycle, interaction structure, information hierarchy or visual language; retire the rejected composition. Compare a few materially different low-cost arrangements against one real use sequence, including what each lets the user understand and control. Record the sequence, alternatives, chosen structure and tradeoff in the active Issue before writing prototype UI. Do not create a side document for this checkpoint.

Communication apps such as WeChat and Telegram inform navigation, reading, input and recovery conventions. SillyTavern may inform conversation mechanisms; it is not a roleplay or visual target for Noema. These references do not prescribe an exact messenger layout, agent roster, permanent room structure or brand.

Before choosing components, decide what the whole screen should make prominent and what can recede. Treat inherited layouts and navigation as hypotheses, not requirements; preserve familiar actions without assuming their usual arrangement.

Before turning a new capability into a visible screen element, trace its real lifecycle: who owns its source, what event creates or changes it, whether it persists, what model/tool work and recurring cost it requires, how stale or failed results are corrected, and what control the user needs. Then decide whether the capability belongs in ordinary conversation, an on-demand detail, or only in internal execution. If those choices are unknown, do not invent an always-on card, timeline, status, or generated message that makes the mechanism look settled. A concept prototype may expose the open question, but must not imply a working or chosen lifecycle.

Use relevant design references to understand how their choices work together, rather than collecting attractive components. Develop a coherent visual idea across composition, typography, graphics, wording, states and narrow layouts; judge populated screens as a whole. A large illustration, unusual color or hidden sidebar is a choice with costs, not a reusable recipe. Tools and catalogs support this judgment; they do not supply it.

Before asking for a directional decision, show a realistic user sequence or prototype, its intended benefit and strongest alternative. State what is existing, proposed and unknown. Evaluate feedback against the brief and observed behavior: distinguish taste and explicit direction from factual or causal claims, and retain what remains supported. Narrow a correction to the premise that failed; do not turn criticism into an opposite prohibition. If the user rejects a prototype, remove it from active candidates and update the durable checkpoint before exploring a replacement. Review gates do not replace this judgment.

Keep the user's requested feedback gates. Ordinary reversible component and implementation choices stay autonomous. New state or architecture follows `noema-architecture-review` when its trigger applies.

## Stable quality floor

- The primary activity, participants, context and actual state are clear.
- Familiar actions have consistent affordances, feedback, keyboard access and visible focus.
- Claims match implementation; demo data and simulated behavior are labeled.
- Empty, loading, active, interrupted, failed and recovered states are covered where relevant.
- Contrast, zoom, reduced motion, narrow windows and overflow work in the rendered app.
- Runtime details appear only when they help the user understand or control what is happening.

## Delivery

Use populated, representative content and a complete interaction rather than a polished empty screen. Match prototype fidelity to the question; it is not accepted design or real model behavior merely because it runs.

Inspect the running application at desktop and narrow sizes, exercise primary actions and keyboard paths, and fix visible defects before reporting visual delivery. Keep usability checks, observed product benefit and user aesthetic feedback distinct. Preserve durable decisions and evidence in their existing project records; remove superseded prototypes instead of accumulating candidates.
