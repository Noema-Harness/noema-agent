---
name: Noema Conversation Surface
description: Chinese-first desktop conversation organized as a continuous, high-density transcript with visible, source-linked work.
colors:
  accent: "#a34432"
  accent-deep: "#743629"
  accent-soft: "#f1e5df"
  ground: "#f3f2ee"
  paper: "#faf9f6"
  paper-alt: "#eeede8"
  ink: "#242622"
  muted: "#6d6e68"
  line: "#d8d7d0"
  line-strong: "#bab9b1"
  success: "#367258"
  warning: "#8b662c"
  error: "#a94136"
typography:
  body:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "13px"
  conversation:
    fontSize: "13px"
    lineHeight: 1.62
  author:
    fontSize: "10px"
    fontWeight: 620
  timestamp:
    fontSize: "9px"
  inline-code:
    fontFamily: "Consolas, Cascadia Code, monospace"
    fontSize: "0.9em"
shape:
  controls: "2px"
  dialogs: "4px"
---

# Noema Conversation Surface

## Working visual premise

The screen reads as one continuous conversation record, not a stack of role cards. A narrow author-and-time rail makes turns easy to scan; message text occupies one shared reading column. A restrained vermilion accent marks the user's words and primary actions. Room lists behave like an index, while the writing area sits at the foot of the transcript as a ruled surface.

This is an assistant-selected direction prepared for review after repeated feedback that the familiar avatar, bubble, rounded-composer shell felt AI-generated. It is not an accepted Noema brand identity. The product-wide visual identity remains open.

The visual character should feel contemporary, thoughtful and personal, with high information density. Use typography, alignment and rhythm to distinguish Noema. Avoid manufacturing identity with gradients, floating cards, decorative avatars, oversized empty states, generic AI iconography, faux paper texture or retro display type. Familiar chat actions remain easy to find.

## Palette and type

Use the warm mineral ground, near-white reading surface and charcoal text defined in the front matter. Keep vermilion to selected navigation, the user's author marker, focus and primary actions. Use status colors only for truthful success, running, warning and failure states.

Use the operating-system sans stack for Chinese and Latin interface text. Message copy stays readable at 13px desktop and 12px narrow with compact line height. Author, source and status labels remain secondary; timestamps use tabular numerals. Use monospace only for code. Do not add a font dependency to simulate a brand.

## Composition

The desktop shell is a two-column workspace without a separate branded top bar. The left rail is a compact conversation index with Noema as the fixed primary entry and other chats below. The active chat uses a short header, full-width scroll area, and a consistent author gutter. Do not center each message in a narrow bubble column.

Each turn is a row in one vertical transcript. Sender and time occupy the gutter; content, reply/forward references and message actions share the reading column. User messages use a slim accent rule rather than a filled bubble. Agent messages use the same text surface and clearly name their sender. Keep separators quiet and let content establish the rhythm.

The composer shares the transcript's reading-column width and uses a top rule rather than a floating card. Keep send/stop controls visible, keyboard instructions concise and the accurate data-flow statement readable. Provider configuration appears only when it needs attention or in settings.

## Action and state presentation

An actual asynchronous work record follows its source turn in the same content column. Use a compact ruled block with the real executor, scope, current state, result, stop/failure controls and independent verification. Do not add decorative task indicators or imply general delegation.

Represent loading, empty, failed, interrupted and recovered states in the same transcript grammar. Empty states should orient the user without a centered illustration or marketing claim. Keep actions discoverable by keyboard and pointer; provide visible focus and sufficient contrast.

## Narrow windows

At 700px and below, show either the conversation index or one chat, with a direct back action. Reduce the author gutter to preserve a readable text measure. Message, source and action content must wrap without horizontal overflow. The settings control remains reachable from both views.

## Sources of truth

Product and interaction constraints live in [the chat redesign brief](docs/design/chat-redesign-brief.md) and [ADR 0026](docs/decisions/0026-noema-first-chat-and-visible-actions.md). This file records the current visual implementation only. Revisit this direction when real use shows that the transcript impairs speaker scanning, ordinary conversation or action comprehension; do not treat style feedback as proof of product positioning.
