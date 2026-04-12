# Ink TUI Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the InkOS CLI TUI as a fixed-layout Ink dashboard with a persistent highlighted composer and a status rail directly above it.

**Architecture:** Keep `@actalk/inkos-core` unchanged and swap the CLI shell from `readline + ANSI` to `Ink + React`. `app.ts` becomes the launcher; new dashboard components render header, conversation, status, and composer from persisted interaction session data.

**Tech Stack:** TypeScript, React, Ink, Vitest

---

### Task 1: Add the Ink runtime dependencies

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `pnpm-lock.yaml`

**Step 1: Add CLI dependencies**

Add the runtime and test dependencies needed for the new shell.

**Step 2: Verify installation**

Run: `pnpm --dir packages/cli install`

Expected: dependencies resolve and lockfile updates cleanly.

### Task 2: Add failing tests for the dashboard contract

**Files:**
- Modify: `packages/cli/src/__tests__/tui-layout.test.ts`
- Create: `packages/cli/src/__tests__/tui-dashboard.test.tsx`

**Step 1: Write failing tests**

Cover:
- header displays project, book, mode, and model
- status rail appears above the composer
- composer placeholder / highlight shell renders
- conversation pane renders user and assistant messages separately

**Step 2: Run tests to verify they fail**

Run: `pnpm --dir packages/cli exec vitest run src/__tests__/tui-layout.test.ts src/__tests__/tui-dashboard.test.tsx`

Expected: FAIL because the Ink dashboard components do not exist yet.

### Task 3: Build dashboard view-model helpers

**Files:**
- Create: `packages/cli/src/tui/dashboard-model.ts`
- Create: `packages/cli/src/tui/dashboard-model.test.ts`

**Step 1: Write failing tests**

Verify session data is mapped into:
- header badge data
- conversation rows
- recent event rows
- pending decision summary

**Step 2: Run tests to verify they fail**

Run: `pnpm --dir packages/cli exec vitest run src/tui/dashboard-model.test.ts`

Expected: FAIL because the helpers do not exist yet.

**Step 3: Write minimal implementation**

Create pure helpers so the Ink components can stay thin.

**Step 4: Run tests to verify they pass**

Run: `pnpm --dir packages/cli exec vitest run src/tui/dashboard-model.test.ts`

Expected: PASS

### Task 4: Implement the Ink dashboard shell

**Files:**
- Create: `packages/cli/src/tui/dashboard.tsx`
- Modify: `packages/cli/src/tui/app.ts`
- Optionally modify: `packages/cli/src/tui/output.ts`

**Step 1: Write or extend a failing dashboard render test**

Assert that the mounted dashboard contains:
- a fixed header
- conversation content
- status rail
- highlighted composer

**Step 2: Run tests to verify they fail**

Run: `pnpm --dir packages/cli exec vitest run src/__tests__/tui-dashboard.test.tsx`

Expected: FAIL

**Step 3: Write minimal implementation**

Implement:
- `InkTuiDashboard` component
- local submit state
- composer submission through `processProjectInteractionInput`
- session-driven refresh after each interaction

**Step 4: Run tests to verify they pass**

Run: `pnpm --dir packages/cli exec vitest run src/__tests__/tui-dashboard.test.tsx src/__tests__/tui-layout.test.ts`

Expected: PASS

### Task 5: Reconcile launcher behavior and remove obsolete readline assumptions

**Files:**
- Modify: `packages/cli/src/tui/app.ts`
- Modify: `packages/cli/src/tui/effects.ts`
- Modify or remove: old prompt-related tests as needed

**Step 1: Replace the old REPL entry**

Make `launchTui()` mount Ink instead of starting a `readline` loop.

**Step 2: Verify startup / setup flow**

Run: `pnpm --dir packages/cli exec vitest run src/__tests__/tui-command.test.ts src/__tests__/tui-layout.test.ts src/__tests__/tui-dashboard.test.tsx`

Expected: PASS

### Task 6: Build verification

**Files:**
- Modify: any files touched above

**Step 1: Run focused tests**

Run: `pnpm --dir packages/cli exec vitest run src/__tests__/tui-layout.test.ts src/__tests__/tui-dashboard.test.tsx`

Expected: PASS

**Step 2: Run CLI build**

Run: `pnpm --dir packages/cli run build`

Expected: PASS

**Step 3: Commit**

```bash
git add docs/plans/2026-04-11-ink-tui-dashboard-design.md docs/plans/2026-04-11-ink-tui-dashboard-implementation.md packages/cli/package.json pnpm-lock.yaml packages/cli/src/tui/app.ts packages/cli/src/tui/dashboard.tsx packages/cli/src/tui/dashboard-model.ts packages/cli/src/__tests__/tui-layout.test.ts packages/cli/src/__tests__/tui-dashboard.test.tsx
git commit -m "feat(tui): rebuild CLI shell with Ink dashboard"
```
