---
name: Noema Social Chat
description: A Chinese-first desktop chat organized around stable agent identities and independent conversation rooms.
colors:
  primary: "#2e5c49"
  primary-deep: "#244536"
  core-identity: "#e1eee3"
  specialist-identity: "#f2e9dd"
  specialist-ink: "#815334"
  ground: "#e9ede7"
  paper: "#fbfcf9"
  paper-alt: "#f4f6f1"
  ink: "#1f2d27"
  muted: "#65736b"
  line: "#dce3dc"
  identity-highlight: "#c9d98b"
  success: "#367258"
  warning: "#8b662c"
  error: "#a94136"
typography:
  body:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "14px"
  title:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "23px"
    fontWeight: 660
    lineHeight: 1.05
  message:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    lineHeight: 1.72
  dialog-title:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "19px"
    fontWeight: 680
  empty-state-title:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "17px"
    fontWeight: 660
  identity:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 720
  compact:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "12px"
  control:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "11px"
  label:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "10px"
    fontWeight: 680
  timestamp:
    fontFamily: "Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "9px"
  inline-code:
    fontFamily: "Consolas, Cascadia Code, monospace"
    fontSize: "0.9em"
rounded:
  micro: "2px"
  small: "4px"
  small-control: "5px"
  control: "7px"
  search: "8px"
  room-item: "9px"
  compact-item: "10px"
  composer: "11px"
  panel: "12px"
  dialog: "13px"
  circle: "50%"
  agent-mark: "12px 12px 12px 4px"
  agent-mark-small: "8px 8px 8px 3px"
  agent-mark-compact: "10px 10px 10px 3px"
  agent-message: "4px 13px 13px 13px"
  user-message: "13px 4px 13px 13px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "30px"
  room-selected:
    backgroundColor: "#eef3ec"
    rounded: "{rounded.room-item}"
    padding: "9px 10px"
  composer:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
    padding: "12px 14px 9px"
    height: "106px"
  responder-selected:
    backgroundColor: "#edf3ed"
    textColor: "{colors.primary-deep}"
    rounded: "{rounded.control}"
    padding: "4px 8px 4px 5px"
---

# Design System: Noema Social Chat

## Overview

**Creative North Star: “Independent Rooms for Ongoing Conversation”**

This Windows-first, Chinese-first desktop slice uses familiar chat conventions. The active room owns the main area; a recent-chat sidebar keeps Noema and professional agents easy to return to. Stable agent identities appear across rooms, while each private or group room keeps its own transcript. In group rooms, the sender can choose who responds to each turn. This is the current assistant-selected interface direction, not a user-confirmed brand identity.

The interface uses a quiet warm-gray-green ground around paper-white chat surfaces, forest-green actions, and distinct identity marks for Noema and a professional contact. The roomy desktop layout gives the conversation most of the space. On narrow screens, the app switches between the chat list and the selected room, retaining a compact top bar and direct navigation back. Model and service information stays visible but secondary to the room and its messages.

The palette, type scale, and surface styling document this implementation slice. They remain changeable design choices, not permanent Noema brand assets. The earlier root-conversation and background-worker composition is historical; it is not the current main chat surface.

The stylesheet also retains earlier `#legacy` interface rules before the `.social-shell` block. Those styles are deprecated for the current main surface and are outside this design system; do not reuse their one-off values as current social-chat tokens.

**Key Characteristics:**
- A room-centered chat surface with a persistent desktop contact/recent-chat list.
- Stable identity marks distinguish Noema from professional agents across separate rooms.
- Group turns expose an explicit responder choice.
- Engineering work is explicitly switched from chat and returns as an activity in the same room.
- Local transcript storage and the selected FreeLLMAPI model boundary are stated in the interface.

## Colors

The current slice pairs a muted green-gray ground and paper surfaces with forest-green actions; pale green and warm beige marks distinguish agent identities.

### Primary
- **Forest action green** (`{colors.primary}`): Primary send and confirmation actions, selected response controls, and ready indicators. Keep connection state truthful; green must not imply a successful reply when only a model is listed as available.
- **Deep forest** (`{colors.primary-deep}`): Emphasis for selected responder controls and identity details.

### Neutral
- **Warm green-gray ground** (`{colors.ground}`): The desktop shell behind the chat and sidebar surfaces.
- **Paper white** (`{colors.paper}`): Main conversation panel, sidebar, and modal surfaces.
- **Quiet paper tint** (`{colors.paper-alt}`): Secondary control surfaces and subtle hover states.
- **Deep green ink** (`{colors.ink}`): Main headings, message text, and control labels.
- **Muted leaf gray** (`{colors.muted}`): Supporting copy and secondary status labels.
- **Soft divider** (`{colors.line}`): Panel separation, input outlines, and low-emphasis borders.

### Tertiary
- **Noema identity green** (`{colors.core-identity}`): The light field behind Noema's persistent identity mark.
- **Professional-contact beige** (`{colors.specialist-identity}`) and **earth-brown ink** (`{colors.specialist-ink}`): Distinguish the professional contact mark from Noema without implying provider health or capability.
- **Identity highlight** (`{colors.identity-highlight}`): Small accent bars in the brand symbol; keep its use limited to that mark.

### Named Rules
**The Room Truth Rule.** Use color to identify people, places, and current state. Never use a status color to imply a reply succeeded, a model is reachable now, or an agent has capabilities that the live state does not confirm.

## Typography

**Display Font:** Segoe UI Variable, with Segoe UI and Chinese UI sans-serif fallbacks.
**Body Font:** Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif.
**Label/Mono Font:** Consolas / Cascadia Code for code in messages only.

**Character:** Compact, native-feeling sans-serif typography supports Chinese conversation and clear control labels. Message copy is more open than metadata; timestamps and room previews remain quiet.

### Hierarchy
- **Title** (weight 660, 23px, line-height 1.05): Chat-list heading.
- **Dialog / empty-state title** (weight 680/660, 19px/17px): Modal heading and empty-room prompt.
- **Identity mark** (weight 720, 16px): Initial inside the stable agent identity tile.
- **Room title** (weight 680, 14px): Identifies the active private or group room in its header.
- **Message** (regular, 13px, line-height 1.72): Conversation body on desktop; narrows to 12px on smaller screens.
- **Control / label** (11px/10px): Compact controls, section labels, provenance, and supporting metadata.
- **Timestamp** (9px): Secondary time marks.
- **Inline code** (0.9em): Code within message text uses the monospace stack; fenced blocks use 11px Consolas/Cascadia Code.

The complete observed social-chat font-size set is 9, 10, 11, 12, 13, 14, 16, 17, 19, and 23px, plus inline code at 0.9em. Line-height values present in this slice range from 1 to 1.72 and are attached to the specific text roles in CSS.

## Layout

At desktop widths, a 58px top bar sits above a two-column body: a 280–324px conversation sidebar beside the flexible active-room panel. The sidebar groups recent rooms with search and a new-group action; the active room contains its own header, scrollable message thread, responder controls when applicable, composer, and a short data-flow note. The message sequence is centered and capped at 760px for readable line length. The shell has a 320px minimum width.

At widths up to 700px, the sidebar and room become mutually exclusive views inside the same shell; a back control returns from the room to the list, and the model selector leaves the top bar. At 420px and below, horizontal padding and secondary metadata shrink further. Group creation and model settings remain dialogs sized to the available viewport. Preserve these actual breakpoints and the list-to-room navigation behavior when adapting this surface.

Spacing is compact around labels and controls (commonly 7–12px) and wider around the message thread (17–21px between messages, 24px desktop top inset). The composer stays anchored below the thread rather than becoming a floating tool panel.

## Elevation & Depth

The chat surface relies mostly on tonal separation and thin borders: the green-gray shell frames paper panels, selected rooms use a light tint, and message bubbles use subtle tinted fills. Shadows are reserved for modal separation and a small composer focus halo. Keep ordinary navigation and messages visually flat.

### Shadow Vocabulary
- **Dialog lift** (`0 20px 60px rgb(21 35 26 / 18%)`): Separates group and connection settings dialogs from the dimmed chat.
- **Composer focus halo** (`0 0 0 3px rgb(46 92 73 / 8%)`): Makes the focused message field visible without changing the conversation hierarchy.

## Shapes

The observed corner vocabulary includes 2, 4, 5, 7, 8, 9, 10, 11, 12, and 13px radii plus circular marks (`50%`). Controls generally use 7–9px; the sidebar and conversation panels use 12px corners, and the composer uses 11px. Agent identity tiles use soft asymmetric silhouettes with a small clipped corner. Message bubbles use directional asymmetric corners: the agent bubble has a tighter upper-left corner and the user's bubble a tighter upper-right corner. Thin green-gray strokes define panels, fields, and selection states; avoid adding heavy outlines or a generic card around each message.

## Components

### Buttons
- **Primary send / confirm:** Compact forest-green button with white text, a 7px radius, and a 30px height for the composer send action. Group and settings dialog actions use the same green fill at a 35px minimum height.
- **Disabled:** Retain the button shape but mute the green surface; disabled state must remain visibly distinct from a ready-to-send action.
- **Focus:** Keyboard focus uses a 3px outline with offset; preserve it on icon buttons, selects, inputs, and the composer.

### Inputs / Fields
- **Search:** A 38px-high, lightly tinted field with an 8px radius, search icon, and optional shortcut hint. Keep its placeholder legible.
- **Composer:** A white multiline field with an 11px radius, thin outline, 106px desktop minimum height, and a green focus halo. It remains part of the active room and supports Enter to send / Shift+Enter for a line break as labeled in the interface.
- **Settings and group fields:** White inputs with a thin outline, 7px radius, and direct Chinese labels.

### Navigation
- **Conversation list:** Each row shows a room title, recent message preview, time, and one or more stable agent marks. Use a pale green surface and border to identify the selected room.
- **Narrow layout:** Replace the desktop two-column layout with one view at a time. Keep the back affordance in the room header and hide the desktop model selector while preserving access to model settings.

### Cards / Containers
- Use the two large paper panels as the page's main containers. The active room itself is the content surface; do not wrap every message in a separate raised card.
- Group and connection settings use a paper dialog over a dimmed backdrop. A selected group member gets a light green row fill and border.

### Identity Marks
- Noema uses a pale green square-like mark; the professional contact uses a pale beige mark with warm-brown lettering. A group avatar may stack these marks. Keep identity styling stable across the room list, header, message attribution, and responder picker.

### Message Bubbles
- Agent messages are left-aligned on a very light neutral-green fill; user messages are right-aligned on forest green with white text. Keep timestamps and provenance separate from the message body.
- Group responses must make the responding agent legible. A per-turn responder choice belongs directly above the composer, not in a separate operations panel.

### Project Work Activity
- A compact “聊天 / 项目工作” switch sits above the composer only in rooms with a capable agent. Project work is never inferred from ordinary chat text.
- The work record stays in its originating room as one durable activity card, visually distinct from a chat bubble but not moved into a global task dashboard.
- The card identifies the specialist, current status, user request, chosen project folder (collapsible), result, stop action, and whether Noema independently verified the declared file condition. A worker's final text is not the verification badge.
- Starting work requires the user to choose a folder. The folder picker discloses third-party model transmission, Windows sandbox limitations, and that stopping does not roll back file edits. Do not imply that the chosen path is a complete read/network security boundary.

### Status and Data Boundary
- The top bar may show that the local FreeLLMAPI service is connected and the selected model's reported availability. Treat this as current status information, not a guarantee that the next generation will succeed.
- Keep the visible data statement accurate: chat records are stored locally and sent to the currently selected model via FreeLLMAPI after sending. Do not imply local-only inference or external provider state beyond the observed app state.

## Do's and Don'ts

### Do:
- **Do** make the current room the main focus and keep the sidebar about returning to a person or recent conversation.
- **Do** preserve separate private and group transcripts while reusing stable agent identity marks.
- **Do** show the group responder choice for each turn and identify which agent actually replied.
- **Do** keep project work attached to its room and distinguish “worker finished” from “Noema verified.”
- **Do** keep model and service state present but subordinate, with wording tied to the state the app actually knows.
- **Do** retain the local-storage and FreeLLMAPI data boundary in concise, readable language.
- **Do** let narrow screens move cleanly between the chat list and one active room.
- **Do** treat the current palette and type as implementation choices that may evolve.

### Don't:
- **Don't** turn the main chat into a dashboard, task panel, or abstract relationship map.
- **Don't** imply cross-room memory, personality growth, tool execution, or external-provider state unless the implementation establishes it.
- **Don't** equate a model directory's “ready” label or service connection with a successful response.
- **Don't** describe Noema or professional agents as conscious or as having human feelings.
- **Don't** present the green and beige palette as a user-approved permanent brand system.
