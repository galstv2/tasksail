# TaskSail — Visual Walkthrough

> Auto-generated on 2026-04-17 by Playwright screenshot automation.

This document provides a visual tour of every major screen and modal in the TaskSail desktop application.

---

## App Shell — Idle State

The main TaskSail window on startup in Standard Mode. The expanded sidebar shows the active context pack, repo-selection scope controls, and the Deep Focus toggle (off). The central Task Board and config rail are visible on the right.

![App Shell — Idle State](screenshots/01-app-shell-idle-state.png)

---

## Theme — dark Mode

After toggling the theme to dark mode. All CSS variables update instantly via the data-theme attribute.

![Theme — dark Mode](screenshots/02-theme-dark-mode.png)

---

## Context Pack Sidebar — Compact

The left sidebar in compact (collapsed) mode showing the active context pack icon, status indicator, and expand toggle. This is the default state on wide viewports.

![Context Pack Sidebar — Compact](screenshots/03-context-pack-sidebar-compact.png)

---

## Context Pack Sidebar — Expanded

The left sidebar expanded showing the context pack list, activation controls, and standard-mode scope selection with repo checkboxes. Deep Focus is toggled off.

![Context Pack Sidebar — Expanded](screenshots/04-context-pack-sidebar-expanded.png)

---

## Deep Focus — Summary

The Deep Focus section showing the Workspace Selection panel with the Deep Focus Mode toggle, focus targets, test target, and support targets. Deep Focus narrows the agent workspace scope to specific directories.

![Deep Focus — Summary](screenshots/05-deep-focus-summary.png)

---

## Deep Focus — Editor

The Deep Focus editor showing the full directory tree with expandable nodes. Operators can drill into the repository structure and select specific files or directories as focus targets, test targets, or support targets.

![Deep Focus — Editor](screenshots/06-deep-focus-editor.png)

---

## Planner Modal — Idle

The Planning modal in its idle state. Shows the conversation area, footer buttons (Preview Plan, Submit to Queue), the attach button, and the Bypass Lily group for uploading a pre-written spec.

![Planner Modal — Idle](screenshots/07-planner-modal-idle.png)

---

## Planner Modal — With Input

The operator has typed a task description. The Submit to Queue button becomes active when there is content to send.

![Planner Modal — With Input](screenshots/08-planner-modal-with-input.png)

---

## Agent Configuration Modal

The Agent Configuration modal showing the named workflow agents: Lily (Planning), Alice (PM), Dalton (SWE), Dalton-Verify, and Ron (QA). Each agent has a sprite avatar and configurable parameters.

![Agent Configuration Modal](screenshots/09-agent-configuration-modal.png)

---

## Agent Configuration — Models

The Agent Configuration modal Models tab showing the model catalog. Lists available LLM models with their IDs and allows adding or removing models from the catalog.

![Agent Configuration — Models](screenshots/10-agent-configuration-models.png)

---

## MCP Configuration Modal

The MCP (Model Context Protocol) server configuration modal. Shows enabled/disabled MCP servers, connection status, and allows adding new external MCP endpoints.

![MCP Configuration Modal](screenshots/11-mcp-configuration-modal.png)

---

## Add MCP Server

The Add MCP Server form for registering a new external MCP endpoint. Fields include server name, SSE URL, optional headers for authentication, and agent assignment toggles.

![Add MCP Server](screenshots/12-add-mcp-server.png)

---

## Agent Instructions Browser

The Agent Instructions browser showing per-role instruction markdown files from .github/copilot/instructions/. Allows viewing and editing role-specific prompts.

![Agent Instructions Browser](screenshots/13-agent-instructions-browser.png)

---

## Reinforcement Modal — Overview

The Reinforcement modal showing the overview panel with task stats, total reward, streak, and per-agent cards. This is the operator feedback and reinforcement learning hub.

![Reinforcement Modal — Overview](screenshots/14-reinforcement-modal-overview.png)

---

## Reinforcement — Overview

The Reinforcement modal Overview tab showing specialized controls for operator feedback and agent alignment.

![Reinforcement — Overview](screenshots/15-reinforcement-overview.png)

---

## Reinforcement — Ledger

The Reinforcement modal Ledger tab showing specialized controls for operator feedback and agent alignment.

![Reinforcement — Ledger](screenshots/16-reinforcement-ledger.png)

---

## Reinforcement — Sessions

The Reinforcement modal Sessions tab showing specialized controls for operator feedback and agent alignment.

![Reinforcement — Sessions](screenshots/17-reinforcement-sessions.png)

---

## Task Board — With Tasks

The Task Board showing task cards organized into columns: Open, Pending, Active, Complete, and Error. Cards can be dragged between columns.

![Task Board — With Tasks](screenshots/18-task-board-with-tasks.png)

---

## Task Detail Modal

The Task Detail modal showing the full markdown content of a selected task card. Includes the task title, metadata, and rendered markdown body.

![Task Detail Modal](screenshots/19-task-detail-modal.png)

---

## Task Board — Task Moved to Pending

After dragging a task card from the Open column to the Pending column. The task is now queued for execution by the agent pipeline. When the dropbox watcher picks it up, it transitions to Active and the workflow begins.

![Task Board — Task Moved to Pending](screenshots/20-task-board-task-moved-to-pending.png)

---

## Terminal — Agent Activity

The Terminal Feed showing live agent output after a task was moved to the Pending queue and activated. Timestamped entries show which agent is running and its current progress.

![Terminal — Agent Activity](screenshots/21-terminal-agent-activity.png)

---

## Terminal Feed

The Terminal Feed showing real-time agent output and lifecycle events. Displays timestamped log entries from the workflow pipeline.

![Terminal Feed](screenshots/22-terminal-feed.png)

---

## Context Pack Creation — Existing Project

The Create Context Pack modal with the "Existing project" tab active. Shows the discovery root path input, display name, browse mode, pack destination, and scan-for-repositories trigger.

![Context Pack Creation — Existing Project](screenshots/23-context-pack-creation-existing-project.png)

---

## Context Pack Creation — New Project

The Create Context Pack modal with the "New project" tab active. Shows the project type selector (Monolith vs Distributed), name, and location fields. This flow scaffolds a new project structure from scratch.

![Context Pack Creation — New Project](screenshots/24-context-pack-creation-new-project.png)

---

## Additional States (Not Captured)

The following states require a running backend pipeline or specific task queue state to capture:

- **Planner Active Session** — A live conversation with Lily (the planning agent) showing real-time streaming responses.
- **QA Remediation Loop** — The Task Board showing a task cycling between QA → SWE → QA columns.

