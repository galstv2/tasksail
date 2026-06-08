# Context-Pack Module

`context-pack` owns active context-pack authorization, activation, workspace switch preview/apply/clear, focused repo resolution, Deep Focus normalization, task pack snapshots, writable-root derivation, QMD seed dry-run, and mirror rebuild.

The TypeScript context-pack CLI is not the same as the Python bootstrap parser. Docs should avoid mixing their flags. The QMD seed dry-run command is the supported owner of dry-run plan writing.

## Sources of truth

- [context-pack CLI](../../../src/backend/platform/context-pack/cli.ts)
- [active context-pack policy](../../../src/backend/platform/context-pack/active.ts)
- [workspace switch](../../../src/backend/platform/context-pack/switch.ts)
- [QMD seed dry run](../../../src/backend/platform/context-pack/qmdSeedDryRun.ts)
