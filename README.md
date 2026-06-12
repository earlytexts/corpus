# Corpus

The Markit source texts of David Hume's works, in their original editions.
This is a pure data layer: no code, no build artefacts. It is consumed by the
`computer` service, which compiles and indexes it.

## Layout conventions

- `<work>.mit` — a single-edition work (e.g. `thn.mit`).
- `<work>/index.mit` — a multi-edition work's main text; sibling `<year>.mit`
  files (or `<year>/index.mit` directories) are dated editions. Edition names
  match `\d{4}[a-z]?` (e.g. `1757`, `1742a`).
- A document's `children` metadata lists its parts in order; entries are inline
  `##` section ids or relative file paths (no `.mit` suffix, case-insensitive;
  `x` and `x/index` are both tried). Composite editions (ETSS, FD, HE volumes)
  share text with other works through such references.

## Status

A work in progress, maintained by hand; some files still contain invalid
Markit. Consumers must tolerate compile errors (the Markit compiler returns a
best-effort document).
