---
name: noema-interface-quality
description: Design or materially change user-visible Noema screens, flows, or components. Use before UI implementation and again for visual verification; not for backend-only changes or copy-only edits.
---

# Noema Interface Quality

1. Read the current Issue, product direction, relevant architecture decisions, and existing UI before choosing a pattern. Treat issue mockups and old screenshots as evidence, not permanent style instructions.
2. Before building a substantial screen/flow, inspect a small number of mature, relevant products or primary-source implementations. Extract the specific interaction/layout ideas and tradeoffs that fit this user task; do not copy their branding or turn a reference into a feature checklist. State a design hypothesis, not a claimed universal best practice.
3. Design for the actual task, information hierarchy, and real content. Avoid generic dashboard/chat layouts, decorative cards, placeholder metrics, and vague AI-sounding labels unless the product need justifies them. Keep visual direction open until repeated usage supports a system.
4. Implement a coherent usable screen, including empty, loading, error, disabled, and populated states that apply. Do not stop at a wireframe or a polished static mockup when the requested flow should work.
5. Run the app and inspect the actual interface at its intended size; exercise primary interactions and keyboard/focus behavior. Revise visible defects in hierarchy, spacing, typography, contrast, overflow, or state feedback. A successful build is not visual verification.
6. Capture only durable decisions in ADRs; preserve useful references/screenshots with source and date when they materially inform later work. Do not create a permanent design system from a single screen.
