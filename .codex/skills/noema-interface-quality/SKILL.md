---
name: noema-interface-quality
description: Design or materially change user-visible Noema screens, flows, or components. Use before UI implementation and again for visual verification; not for backend-only changes or copy-only edits.
---

# Noema Interface Quality

## Establish the design question

Read the active Issue, `docs/design/chat-redesign-brief.md` and only the product/architecture records relevant to this change. Check whether the work is exploring a product direction, defining a visual language, or improving an accepted flow. These need different evidence.

Noema is a basic demo. Its current screens and features document implementation, not a finished product or a source of proven differentiation. Start product proposals from a concrete user situation, current alternatives and an intended improvement. Use the demo later to estimate reuse, gaps and removal cost. Do not turn context isolation into a selling point, rebrand prompt-based memory as a novel relationship model, or infer that another existing feature must contain the answer when a proposal is rejected.

Product value and visual identity are related but separate questions. Familiar functionality can have a distinctive, deliberate visual language. A unique feature is not a prerequisite for good visual design, and a polished screen is not evidence of a valuable product. Compare alternatives on the same user problem and outcome, not an engineering invariant against a feature or an implementation method against a value proposition.

## Form a concrete proposal

Communication apps such as WeChat and Telegram inform navigation, reading, input and recovery conventions. SillyTavern may inform conversation mechanisms; it is not a roleplay or visual target for Noema. These references do not prescribe an exact messenger layout, agent roster, permanent room structure or brand.

Inspect relevant mature interfaces and design references for the actual question. State the useful observations and their tradeoffs. Establish intentional choices for composition, typography, density, color, wording and motion; avoid merely restyling the existing shell or selecting an arbitrary anti-default theme. Tools and design catalogs are aids, not aesthetic authority.

Before asking for a directional decision, make the proposal understandable through a realistic user sequence or prototype, its intended benefit and strongest alternative. State what is existing, proposed and unknown. Review gates do not replace the assistant's own premise checks; withdraw conclusions that depend on a rejected premise. Do not present another repackaging of the same unsupported idea for approval.

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
