# Bundled Fonts

TaskSail desktop self-hosts its UI typefaces here so the app renders with its
intended typography offline and in air-gapped or firewalled environments, with
no runtime webfont fetch. These files are consumed by local `@font-face`
declarations in `src/renderer/styles/variables.css`.

## Outfit (sans)

- Family name: `Outfit`
- Files: `outfit-latin.woff2`, `outfit-latin-ext.woff2`
- Type: variable WOFF2 (weight axis), covering weights 400, 500, 600, 700
- Subsets: Latin and Latin Extended, kept as separate files and selected at
  runtime by `unicode-range`
- Upstream: The Outfit Project — https://github.com/Outfitio/Outfit-Fonts
- Webfont build: v15
- License: SIL Open Font License 1.1 (see `OFL-Outfit.txt`)

## Source Code Pro (mono)

- Family name: `Source Code Pro`
- Files: `source-code-pro-400.woff2` (Regular), `source-code-pro-500.woff2`
  (Medium), `source-code-pro-600.woff2` (Semibold)
- Type: static per-weight WOFF2
- Upstream: https://github.com/adobe-fonts/source-code-pro
  (`release` branch, commit 803b7e23ec97, 2025-10-28)
- License: SIL Open Font License 1.1 (see `OFL-SourceCodePro.txt`)

## Provenance

Exact retrieval commands and per-artifact provenance are recorded in
`scratchspace/features/execution/self-host-fonts-validation-log.md`.
