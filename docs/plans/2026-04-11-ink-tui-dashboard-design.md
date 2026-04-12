# Ink TUI Dashboard Design

**Goal:** Replace the current readline-driven TUI shell with a fixed-layout Ink dashboard so conversation, execution status, and the composer remain visible at the same time.

## Context

The current TUI is a linear REPL layered on top of `readline` and ANSI helpers. That shape creates the exact UX problems reported by users:

- the input area is only a prompt prefix, not a persistent composer
- task status is printed inline below the conversation instead of being anchored near the composer
- output pushes the input area downward, so the screen feels unstable
- the shell looks like logs, not a workspace

The interaction core itself is not the problem. Session state, routing, execution, and persistence already exist in `@actalk/inkos-core`.

## Proposed Architecture

Keep the existing interaction core and replace only the CLI shell:

- `packages/cli/src/tui/app.ts`
  becomes a thin launcher that prepares project/model/tools and mounts an Ink app
- new Ink UI modules in `packages/cli/src/tui/`
  own layout, input, and rendering
- existing session persistence stays in `session-store.ts`
- existing command execution still flows through `processProjectInteractionInput`

## Layout

The dashboard is a fixed vertical stack:

1. `Header`
   project, active book, automation mode, model, and a compact execution badge
2. `Conversation`
   recent user / assistant / system messages with stable visual separation
3. `Status Rail`
   current stage, pending decision, and recent events
4. `Composer`
   highlighted input box, helper text, and submit state

The composer stays visually anchored at the bottom of the dashboard. Execution state sits directly above it.

## Rendering Strategy

Use Ink components instead of manual `console.log` output:

- Ink layout primitives for fixed regions
- Ink input handling for keyboard events
- an Ink text input component for the composer
- small view-model helpers that derive display data from the persisted interaction session

No screen-level ANSI animation survives unless it can be expressed as component state. The redesign favors a stable, readable shell over decorative startup animation.

## Interaction Model

- user submits text in the composer
- shell enters `submitting` state
- `processProjectInteractionInput` runs with existing tools
- returned session replaces local session state
- conversation and status panes refresh from the updated session

Errors are shown in the status rail and remain visible until the next successful interaction.

## Non-Goals

- changing the interaction runtime or natural-language router
- changing daemon behavior
- adding a full message history scroller in this pass
- introducing Studio-style navigation into CLI

## Success Criteria

- the composer is always visually distinct and highlighted
- the current execution state is visible without running `/status`
- recent events appear above the composer instead of below it
- new output no longer pushes the prompt into a visually unstable position
- the CLI package still builds and TUI-focused tests cover the new layout contract
