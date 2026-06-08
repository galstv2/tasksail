# Context-Pack Lifecycle

Context packs define the repository estate, QMD scope, focus targets, writable roots, and bootstrap data that bound agent work. The desktop app exposes selection, creation, preview, and apply flows, while backend modules perform validation and mutation.

## Operator Flow

The normal operator path is:

1. Create or choose a context pack.
2. Preview the workspace scope.
3. Apply the selected pack.
4. Draft a task only after a pack is active.

This keeps agent execution tied to an explicit context boundary.

## Backend Flow

The TypeScript context-pack CLI supports activation, workspace switching, and mirror rebuild. The QMD seed dry-run command is a separate CLI. Python context-estate services discover repositories, normalize bootstrap answers, render manifests, and write context-pack drafts.

## Known Source Seam

The TypeScript bootstrap helper currently passes a bootstrap root argument name that the Python bootstrap parser does not accept. Public operator docs should not publish that mismatch as a supported command. The Python parser-owned bootstrap command uses the discovery-root argument.

## Sources of truth

- [context-pack CLI](../../../src/backend/platform/context-pack/cli.ts)
- [QMD seed dry run CLI](../../../src/backend/platform/context-pack/qmdSeedDryRun.ts)
- [Python bootstrap parser](../../../src/backend/scripts/python/bootstrap-context-pack.py)
- [context-estate bootstrap](../../../src/backend/mcp/context_estate/bootstrap.py)
