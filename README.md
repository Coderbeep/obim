<div align="center">

<img src="resources/brand/obim-app-icon.svg" width="96" alt="obim app icon" />

# obim

**Give your thinking room.**

A local-first desktop workspace that keeps your Markdown notes, PDFs, tasks, and Git
history together — in plain files that stay yours.

[![CI](https://github.com/Coderbeep/obim/actions/workflows/ci.yml/badge.svg)](https://github.com/Coderbeep/obim/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Built with](https://img.shields.io/badge/built%20with-Electron%20%C2%B7%20React%20%C2%B7%20TypeScript-blueviolet)

</div>

## Your folder is your workspace

Open any folder and make yourself at home. Your notes, papers, and tasks live on your
computer, in files you can read and use beyond obim.

There is no proprietary database holding your work:

- Notes stay plain `.md` Markdown — open them in any other editor, anytime
- PDFs stay PDFs, untouched
- A task is a Markdown note with a small YAML header, not a row in a hidden store
- obim's internal index and board layout are derived, disposable state — your files
  remain the source of truth

## Read side by side

A paper and a place to think, next to each other.

- **Built-in PDF reader** with text selection and copying, document search, outline
  navigation, page links, zoom, and spread display
- **Import articles** straight into the workspace with a DOI, `doi.org` URL, arXiv
  identifier, or arXiv link — the PDF lands in your workspace as an ordinary file
- **Keep the spark and its source** — select a passage, pick a color, and paste a
  Markdown link into a note that reopens the exact page and re-emphasizes the exact
  selection
- **Referenced in** shows every note that links to the same passage, so you can jump
  between your highlights and your thinking

## Write in Markdown

Room for a sentence, an equation, or a working explanation — and it all stays in an
ordinary Markdown file.

- WYSIWYG-style editor with live inline preview: headings, tables, callouts, KaTeX
  equations, checklists, and links render as you write
- Tabs and split panes keep a note, its source PDF, and the board in view at once
- Command menu, workspace search, bookmarks, and recent files for fast navigation

## Built-in Git, local by default

Keep the path you took.

- Review changes, browse file history, and return to an earlier version of a note
- Git history can stay entirely local
- Connect your own remote when you want to sync, with optional automatic sync

## Download

Grab an installer for your platform from the
[v0.9.0-beta-1 release](https://github.com/Coderbeep/obim/releases/tag/v0.9.0-beta-1):

| Platform | Artifact                     |
| -------- | ---------------------------- |
| macOS    | `.dmg`                       |
| Windows  | `obim-*-setup.exe`           |
| Linux    | `.AppImage`, `.deb` |

## Build from source

You need Node `26.7.0` (see [`.nvmrc`](.nvmrc)) and pnpm `11.19.0`.

```bash
git clone https://github.com/Coderbeep/obim.git
cd obim
pnpm install --frozen-lockfile

# Run in development mode
pnpm run dev
```

Package an installer for your platform:

```bash
pnpm run build:mac    # macOS
pnpm run build:win    # Windows
pnpm run build:linux  # Linux
```

Before contributing changes, run the full correctness gate — type checks, ESLint,
and the Vitest suite:

```bash
pnpm run verify
```

Tip: `pnpm run design-graph` opens a renderer-only component and state catalog for
isolated visual inspection.

## License

[MIT](LICENSE) © Coderbeep

Thanks to [Maciej Janicki](https://github.com/majanicki) for contributions to obim.
Bundled Manrope and Outfit fonts retain their SIL Open Font License notices in
[`resources/brand`](resources/brand).

<div align="center">
Your files. Your history. Room to think.
</div>
