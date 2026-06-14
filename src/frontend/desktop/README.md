# TaskSail Desktop Shell

This package contains the Electron and React operator UI for TaskSail. It is a host-native shell for the supported Unix-based TaskSail workflow and runs against the repository checkout; workflow state remains in the repo workspace and platform state directories.

Start with the root docs for operator setup:

- [TaskSail docs](../../../docs/README.md)
- [Getting Started](../../../docs/getting-started/00-what-is-tasksail.md)
- [Technical Reference](../../../docs/technical/architecture/overview.md)

## Local Development

From this directory:

```bash
npm install
npm run dev
```

Useful package checks:

```bash
npm test
npm run test:css-colors
npm run lint
npm run build
npm run validate:desktop
```

## Packaging

Supported packaging targets follow the current Unix-based runtime support:

```bash
npm run package:mac
npm run package:linux
```

Package output is written under `release/`.

Windows is not a supported TaskSail runtime target today.

The desktop shell does not own queue rules, context-pack mutations, or workflow policy. It calls backend-owned seams through Electron main and the preload bridge, then renders the operator-facing state.
