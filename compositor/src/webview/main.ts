/**
 * The dictionary panel's front-end: a framework-free DOM app that renders the
 * two derived views the extension posts (lemmas with their forms, and variant
 * spellings), filtered by shard letter and paged client-side, with add/remove
 * controls that post single-surface edits back for the extension to validate
 * and write. It holds no dictionary logic of its own — the views arrive
 * derived, filtering/paging are lib/dictionaryPanel.ts, and every edit is just
 * a message. Plain TypeScript + DOM keeps the compositor's runtime
 * dependencies at zero (its first webview).
 *
 * The row shapes are declared locally: the data crosses the postMessage
 * boundary as plain JSON, so the webview needs the structure, not the corpus
 * module that derived it (importing that would drag the whole corpus — and
 * markit — into this bundle). The imperative bootstrap sits at the foot of the
 * file so every const arrow it calls is already defined.
 */

import { filterByLetter, page } from "../lib/dictionaryPanel.ts";

type VariantRow = {
  surface: string;
  spellings: string[];
  ambiguous: boolean;
  letter: string;
};
type LemmaRow = {
  lemma: string;
  headword: boolean;
  forms: string[];
  letter: string;
};
type CurationRow = {
  surface: string;
  count: number;
  letter: string;
  example?: { path: string; line: number };
};
type Data = {
  variants: VariantRow[];
  lemmas: LemmaRow[];
  curation: CurationRow[];
};
type Tab = "lemmas" | "variants" | "curation";
type State = { tab: Tab; letter: string; pageIndex: number };

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => State | undefined;
  setState: (state: State) => void;
};
declare const acquireVsCodeApi: () => VsCodeApi;

const vscode = acquireVsCodeApi();

const PAGE_SIZE = 50;
const LETTERS = ["all", ..."abcdefghijklmnopqrstuvwxyz", "other"];

let data: Data = { variants: [], lemmas: [], curation: [] };
/** The untruncated size of the curation backlog (the panel posts only the most
 * frequent `data.curation`); the Curation tab's note reports it. */
let curationTotal = 0;
let { tab, letter, pageIndex } = vscode.getState() ?? {
  tab: "lemmas" as Tab,
  letter: "all",
  pageIndex: 0,
};

/* The five persistent containers; render() fills them in place. `container` is
 * defined here (not with the DOM helpers below) because it runs at module load,
 * before those consts are initialised. */
const container = (className: string): HTMLDivElement => {
  const element = document.createElement("div");
  element.className = className;
  return element;
};
const tabsEl = container("tabs");
const lettersEl = container("letters");
const addEl = container("add");
const rowsEl = container("rows");
const pagerEl = container("pager");

/* ------------------------------- rendering ------------------------------- */

const render = (): void => {
  vscode.setState({ tab, letter, pageIndex });
  renderTabs();
  renderLetters();
  renderAdd();
  if (tab === "lemmas") renderView(data.lemmas, lemmaRow);
  else if (tab === "variants") renderView(data.variants, variantRow);
  else renderView(data.curation, curationRow);
};

/** Filter the active view to the chosen letter, page it, and render the page's
 * rows (or an empty note) plus the pager. */
const renderView = <T extends { letter: string }>(
  all: T[],
  row: (item: T) => HTMLElement,
): void => {
  const filtered = filterByLetter(all, letter);
  const paged = page(filtered, pageIndex, PAGE_SIZE);
  pageIndex = paged.pageIndex;
  rowsEl.replaceChildren(
    ...(filtered.length === 0
      ? [div("empty", "Nothing here yet.")]
      : paged.items.map(row)),
  );
  renderPager(filtered.length, paged.pageCount);
};

const renderTabs = (): void => {
  tabsEl.replaceChildren(
    tabButton("lemmas", "Lemmas"),
    tabButton("variants", "Variants"),
    tabButton("curation", "Curation"),
  );
};

const tabButton = (which: Tab, label: string): HTMLElement =>
  button(label, "ghost" + (tab === which ? " selected" : ""), () => {
    if (tab === which) return;
    tab = which;
    pageIndex = 0;
    render();
  });

const renderLetters = (): void => {
  lettersEl.replaceChildren(
    ...LETTERS.map((value) =>
      button(
        value === "all" ? "All" : value === "other" ? "#" : value,
        "ghost" + (letter === value ? " selected" : ""),
        () => {
          if (letter === value) return;
          letter = value;
          pageIndex = 0;
          render();
        },
      ),
    ),
  );
};

const renderAdd = (): void => {
  if (tab === "lemmas") {
    const input = textInput("New lemma (a modern headword)");
    const submit = () =>
      sendAdd(input, () => post({ type: "addLemma", lemma: input.value }));
    addEl.replaceChildren(input, button("Add lemma", "", submit));
    onEnter(input, submit);
  } else if (tab === "variants") {
    const surface = textInput("Archaic spelling");
    const spelling = textInput("Modern spelling(s)");
    const submit = () =>
      sendAdd(surface, () =>
        post({
          type: "addVariant",
          surface: surface.value,
          spelling: spelling.value,
        }),
      );
    addEl.replaceChildren(surface, spelling, button("Add variant", "", submit));
    onEnter(surface, submit);
    onEnter(spelling, submit);
  } else {
    // Curation has no add field — its rows carry the actions. Instead the header
    // reports the backlog, noting when only the most-frequent slice is shown.
    const shown = data.curation.length;
    addEl.replaceChildren(
      div(
        "count",
        curationTotal > shown
          ? `The ${shown} most frequent of ${curationTotal} unaccounted surfaces — biggest wins first.`
          : `${curationTotal} unaccounted ${
              curationTotal === 1 ? "surface" : "surfaces"
            } to curate.`,
      ),
    );
  }
};

const renderPager = (total: number, pageCount: number): void => {
  const count = span("count", `${total} ${total === 1 ? "entry" : "entries"}`);
  if (pageCount <= 1) {
    pagerEl.replaceChildren(count);
    return;
  }
  pagerEl.replaceChildren(
    button("‹ Prev", "ghost", () => turnTo(pageIndex - 1), pageIndex === 0),
    span("count", `Page ${pageIndex + 1} of ${pageCount}`),
    button(
      "Next ›",
      "ghost",
      () => turnTo(pageIndex + 1),
      pageIndex >= pageCount - 1,
    ),
    spacer(),
    count,
  );
};

const turnTo = (next: number): void => {
  pageIndex = next;
  render();
};

/* --------------------------------- rows ---------------------------------- */

const lemmaRow = (row: LemmaRow): HTMLElement => {
  const head = div("head");
  head.append(
    span("surface", row.lemma),
    span("tag", row.headword ? "headword" : "referenced"),
    spacer(),
  );
  if (row.headword) {
    head.append(
      button("Remove", "x", () =>
        post({ type: "removeEntry", surface: row.lemma }),
      ),
    );
  }
  const forms = div("forms");
  forms.append(
    ...row.forms.map((form) =>
      chip(form, () => post({ type: "removeEntry", surface: form })),
    ),
  );
  const input = textInput("New form of “" + row.lemma + "”");
  const submit = () =>
    sendAdd(input, () =>
      post({ type: "addForm", lemma: row.lemma, form: input.value }),
    );
  onEnter(input, submit);
  const formadd = div("formadd");
  formadd.append(input, button("Add form", "ghost", submit));
  return block("row", [head, forms, formadd]);
};

/** A backlog surface: its folded form (a link that opens one attested
 * occurrence in context, when one is known), its corpus-wide count, and the
 * three ways to account for it — each delegating to the editor quick-fix's full
 * resolution cascade (Modern outright; Respell…/Lemma… prompt for a target). */
const curationRow = (row: CurationRow): HTMLElement => {
  const head = div("head");
  const example = row.example;
  head.append(
    example === undefined
      ? span("surface", row.surface)
      : button(row.surface, "link", () =>
          post({ type: "openExample", path: example.path, line: example.line }),
        ),
    span("count-tag", `×${row.count}`),
  );
  const curate = (kind: "modern" | "respell" | "lemma", label: string) =>
    button(label, "ghost", () =>
      post({ type: "curate", surface: row.surface, kind }),
    );
  const actions = div("curate");
  actions.append(
    curate("modern", "Modern"),
    curate("respell", "Respell…"),
    curate("lemma", "Lemma…"),
  );
  return block("row", [head, actions]);
};

const variantRow = (row: VariantRow): HTMLElement => {
  const head = div("head");
  head.append(
    span("surface", row.surface),
    span("arrow", "→"),
    span("", row.spellings.join(" ")),
  );
  if (row.ambiguous) head.append(span("tag", "ambiguous"));
  head.append(spacer());
  if (!row.ambiguous) {
    head.append(
      button("Remove", "x", () =>
        post({ type: "removeEntry", surface: row.surface }),
      ),
    );
  }
  return block("row", [head]);
};

/* ------------------------------ DOM helpers ------------------------------ */

/** Post an add only when the trigger field is non-empty (the extension does the
 * real word-level validation and reports any rejection). */
const sendAdd = (field: HTMLInputElement, send: () => void): void => {
  if (field.value.trim() !== "") send();
};

const post = (message: unknown): void => vscode.postMessage(message);

const onEnter = (input: HTMLInputElement, run: () => void): void => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") run();
  });
};

const chip = (text: string, onRemove: () => void): HTMLElement =>
  block("chip", [text, button("×", "x", onRemove)], "span");

const button = (
  label: string,
  className: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement => {
  const element = document.createElement("button");
  element.textContent = label;
  if (className !== "") element.className = className;
  element.disabled = disabled;
  element.addEventListener("click", onClick);
  return element;
};

const textInput = (placeholder: string): HTMLInputElement => {
  const element = document.createElement("input");
  element.type = "text";
  element.placeholder = placeholder;
  return element;
};

const div = (className: string, text?: string): HTMLElement =>
  block(className, text === undefined ? [] : [text]);

const span = (className: string, text: string): HTMLSpanElement => {
  const element = document.createElement("span");
  if (className !== "") element.className = className;
  element.textContent = text;
  return element;
};

const spacer = (): HTMLElement => span("spacer", "");

/** A `<div>` (or another `tag`) carrying `className`, wrapping `children`. */
const block = (
  className: string,
  children: (Node | string)[],
  tag: "div" | "span" = "div",
): HTMLElement => {
  const element = document.createElement(tag);
  if (className !== "") element.className = className;
  element.append(...children);
  return element;
};

/* ------------------------------- bootstrap ------------------------------- */

document.body.append(tabsEl, lettersEl, addEl, rowsEl, pagerEl);

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as { type: string } & Partial<Data> & {
      curationTotal?: number;
    };
  if (message.type === "data") {
    data = {
      variants: message.variants ?? [],
      lemmas: message.lemmas ?? [],
      curation: message.curation ?? [],
    };
    curationTotal = message.curationTotal ?? data.curation.length;
    render();
  }
});

post({ type: "ready" });
render();
