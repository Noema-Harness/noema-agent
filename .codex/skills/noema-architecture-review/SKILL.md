---
name: noema-architecture-review
description: Review a proposed Noema product or architecture change before implementation when it adds a subsystem, persistent state, autonomous behavior, external integration, or major dependency.
---

# Noema Architecture Review

Use this only for product-shaping or high-impact architecture work; do not apply it to routine edits.

Before accepting a change:

1. Identify whether this is problem discovery or refinement of an accepted direction. Name the everyday user problem, current alternative and intended improvement. Existing demo capabilities are implementation evidence, not reasons to choose a product direction. Keep engineering invariants, implementation methods, user outcomes and visual identity distinct; compare alternatives on the same user problem. If the premise fails, withdraw dependent proposals rather than reframe an existing feature as the new purpose.
2. Apply the standalone-app test: why must this responsibility belong to Noema rather than a skill, plugin, existing agent, or small external tool?
3. Identify the source of truth, owner, lifecycle, permissions, failure behavior, and removal path for every new state or integration.
4. Prefer one simple, replaceable boundary over a new framework, daemon, abstraction layer, or plugin marketplace unless independent lifecycle or security needs justify it.
5. Check relevant prior decisions and evidence; separate confirmed facts from accepted assumptions. Competitor feature presence is evidence of an alternative or a possible baseline, not proof of execution quality, satisfaction, or a reason to avoid parity. Treat promotional claims as claims; compare the same user outcome, including observed quality, limitations, cost, and fit. A selling point may be better execution or a useful combination; it need not be novel. Intuition may support a reversible decision without an experiment, but do not present it as proven.
6. If the choice is durable or changes a product invariant, write/update an ADR before implementation. Keep the ADR focused on the decision, alternatives, consequences, and reconsideration trigger.

This review is a design aid, not a mandatory approval checklist for every code change. Keep moving when the decision is reversible and the next step can be safely inspected or rolled back.
