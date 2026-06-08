# Third-Party Licenses And Notices

TaskSail is licensed under the MIT License. See [LICENSE](LICENSE).

This notice summarizes third-party materials that are part of the source tree or
desktop package boundary, and separates them from development-only tooling.

## Desktop Runtime

The desktop package includes Electron runtime binaries through electron-builder.
Electron is MIT licensed and includes upstream runtime components such as
Chromium and Node.js under their respective upstream notices.

The desktop renderer runtime uses this MIT-licensed React dependency closure
from `src/frontend/desktop/package-lock.json`:

| Package | Version | License |
| --- | --- | --- |
| `js-tokens` | `4.0.0` | MIT |
| `loose-envify` | `1.4.0` | MIT |
| `react` | `18.3.1` | MIT |
| `react-dom` | `18.3.1` | MIT |
| `scheduler` | `0.23.2` | MIT |

## Bundled Fonts

TaskSail desktop self-hosts these fonts:

| Font | Files | License |
| --- | --- | --- |
| Outfit | `outfit-latin.woff2`, `outfit-latin-ext.woff2` | SIL Open Font License 1.1, see `src/frontend/desktop/src/assets/fonts/OFL-Outfit.txt` |
| Source Code Pro | `source-code-pro-400.woff2`, `source-code-pro-500.woff2`, `source-code-pro-600.woff2` | SIL Open Font License 1.1, see `src/frontend/desktop/src/assets/fonts/OFL-SourceCodePro.txt` |

Font provenance is recorded in `src/frontend/desktop/src/assets/fonts/README.md`.

## Root Optional Runtime Dependency

`pnpm licenses list --prod --json` currently reports the root optional
`@reflink/reflink` packages as MIT licensed. The command output includes local
checkout paths and should be used as closeout evidence rather than copied into
public docs.

## Project Assets And Templates

The TaskSail desktop icon files in `src/frontend/desktop/build/` are
project-authored TaskSail brand assets. The SVG file is the canonical source for
the PNG icon outputs.

The `.gitignore` templates in
`src/frontend/desktop/electron/contextPack/actions/gitignoreTemplates/` are
project-authored minimal templates used by context-pack creation.

## Development Tooling

Development, test, and build tools are dev-only for this release and are not
bundled into the desktop runtime unless a future package configuration changes
that boundary. Current desktop development lockfile entries use permissive
licenses such as MIT, ISC, BSD, Apache-2.0, BlueOak-1.0.0, CC-BY-4.0,
Python-2.0, and WTFPL variants.

Python entries in `requirements-dev.txt` are development tooling only.
