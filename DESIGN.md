---
name: Noema Conversation Surface
description: A provisional desktop conversation surface organized around message exchanges and real work returned to its source chat.
colors:
  ground: "#f4f6f5"
  paper: "#fbfcfb"
  ink: "#202a28"
  muted: "#64716d"
  line: "#e1e6e3"
  user-message: "#e8eeeb"
  signal: "#b94f36"
typography:
  body:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "13px"
  conversation:
    fontSize: "15px"
    lineHeight: 1.68
shape:
  user-message: "13px 13px 3px 13px"
  controls: "2px"
---

# Noema Conversation Surface

## Current implementation under review

The desktop uses a conversation index beside the active chat. User messages sit on the right as compact, tinted prompts; Noema and specialist replies stay left aligned in an open reading surface. Project execution appears only when a real task exists and remains attached to the originating conversation. Navigation and composer retain familiar communication-app conventions.

This is a reversible interface experiment, not an accepted brand identity. The current screen still reads as a conventional messenger shell and has not yet earned a distinct Noema character. Do not describe it as a finished redesign.

## Design constraints

Noema's main chat is the everyday entry point. Ordinary discussion must remain natural; delegation, specialist conversations and project execution appear when the underlying behavior actually occurs. An interface element must not imply hidden summaries, background monitoring, autonomous creation, or other unimplemented work.

Treat role, source and execution status as information: show them at the point where they clarify who said or did what. Do not repeat author/time columns or full-width separators for every message. Keep Chinese text readable, constrain long line lengths, preserve message actions and keyboard access, and check narrow windows as real layouts rather than shrinking a desktop mockup.

## What remains open

The information structure and communication conventions are more mature than the visual expression. Explore Noema's principal-agent relationship, the presence of specialists, and how actual work returns to the conversation before choosing a durable visual identity. Compare real, populated interaction sequences rather than collecting component references. Retire this surface if it continues to look interchangeable with a standard AI chat app; do not fix that failure by changing palette alone.

Product and interaction constraints live in [the chat redesign brief](docs/design/chat-redesign-brief.md) and [ADR 0026](docs/decisions/0026-noema-first-chat-and-visible-actions.md). The current design review and next composition checkpoint are recorded in [Issue #104](https://github.com/c3115644151/noema-agent/issues/104).
