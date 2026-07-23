/**
 * The search panel's front-end: a framework-free DOM app shaped like VSCode's
 * native Search view — a term box with case/whole-word/regex toggles, a
 * replace row behind the usual twisty, author include/exclude filters behind
 * the "…" toggle, and results grouped per edition under catalogue labels. It
 * holds no search logic: every query change posts a (debounced) `search` and
 * the extension posts back grouped, positioned, preview-clipped results; the
 * webview owns only rendering, collapse/dismiss bookkeeping, and turning its
 * buttons into explicit replace-target lists.
 *
 * The wire shapes are declared locally: the data crosses the postMessage
 * boundary as plain JSON, so the webview needs the structure, not the modules
 * that derived it (importing those would drag the corpus — and markit — into
 * this bundle). The imperative bootstrap sits at the foot of the file so every
 * const arrow it calls is already defined.
 */

/* -------------------------------- shapes --------------------------------- */

type Query = {
  term: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string[];
  exclude: string[];
};
type Match = {
  line: number;
  start: number;
  end: number;
  matchText: string;
  before: string;
  after: string;
};
type FileGroup = {
  path: string;
  label: string;
  matches: Match[];
  truncated: boolean;
};
type Results = {
  files: FileGroup[];
  totalMatches: number;
  truncated: boolean;
  error?: string;
};
type AuthorRow = { slug: string; name: string };

/** What persists across hide/show (the webview itself is torn down): the whole
 * query as typed, plus which sections are unfolded. Results do not persist —
 * a fresh webview re-runs its search against the live corpus. */
type State = {
  term: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  includeText: string;
  excludeText: string;
  replaceText: string;
  showReplace: boolean;
  showFilters: boolean;
};

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => State | undefined;
  setState: (state: State) => void;
};
declare const acquireVsCodeApi: () => VsCodeApi;

const vscode = acquireVsCodeApi();

const DEBOUNCE_MS = 250;

let state: State = vscode.getState() ?? {
  term: "",
  isRegex: false,
  caseSensitive: false,
  wholeWord: false,
  includeText: "",
  excludeText: "",
  replaceText: "",
  showReplace: false,
  showFilters: false,
};

let authors: AuthorRow[] = [];
let results: Results | undefined;
/** Result-set bookkeeping, reset whenever fresh results arrive. */
let collapsed = new Set<string>();
let dismissed = new Set<string>();

/* ------------------------------ search flow ------------------------------ */

const queryOf = (): Query => ({
  term: state.term,
  isRegex: state.isRegex,
  caseSensitive: state.caseSensitive,
  wholeWord: state.wholeWord,
  include: state.includeText.split(","),
  exclude: state.excludeText.split(","),
});

const sendSearch = (): void => {
  if (state.term === "") {
    results = undefined;
    renderResults();
    return;
  }
  post({ type: "search", query: queryOf() });
};

let timer: ReturnType<typeof setTimeout> | undefined;
const scheduleSearch = (): void => {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(sendSearch, DEBOUNCE_MS);
};

const save = (): void => vscode.setState(state);

/* ------------------------------- replacing ------------------------------- */

const matchKey = (path: string, match: Match): string =>
  `${path}#${match.line}:${match.start}:${match.end}`;

const surviving = (group: FileGroup): Match[] =>
  group.matches.filter((match) => !dismissed.has(matchKey(group.path, match)));

const target = (path: string, match: Match) => ({
  path,
  line: match.line,
  start: match.start,
  end: match.end,
  matchText: match.matchText,
});

const sendReplace = (targets: { path: string }[]): void => {
  if (targets.length === 0) return;
  post({
    type: "replace",
    query: queryOf(),
    replaceText: state.replaceText,
    targets,
  });
};

/* ------------------------------- rendering ------------------------------- */

const queryEl = document.createElement("div");
const filterAreaEl = document.createElement("div");
const errorEl = document.createElement("div");
const summaryEl = document.createElement("div");
const resultsEl = document.createElement("div");
/** The live term input: results arriving must not rebuild it (that would
 * steal the caret mid-word), so renderResults reaches it through this ref. */
let termInput: HTMLInputElement | undefined;

const render = (): void => {
  save();
  renderQuery();
  renderFilters();
  renderResults();
};

/** The twisty gutter beside the stacked term/replace inputs, native-style. */
const renderQuery = (): void => {
  queryEl.className = "query";
  const twisty = button(state.showReplace ? "▾" : "▸", "", () => {
    state.showReplace = !state.showReplace;
    render();
  });
  twisty.title = "Toggle Replace";
  const gutter = div("gutter", [twisty]);

  const term = textInput("Search block content", state.term);
  termInput = term;
  term.addEventListener("input", () => {
    state.term = term.value;
    save();
    scheduleSearch();
  });
  onEnter(term, sendSearch);
  if (results?.error !== undefined) term.classList.add("error");
  const termRow = div("termrow", [
    term,
    div("toggles", [
      toggle("Aa", "Match Case", state.caseSensitive, (on) => {
        state.caseSensitive = on;
      }),
      toggle("ab", "Match Whole Word", state.wholeWord, (on) => {
        state.wholeWord = on;
      }),
      toggle(".*", "Use Regular Expression", state.isRegex, (on) => {
        state.isRegex = on;
      }),
    ]),
  ]);

  const fields = [termRow];
  if (state.showReplace) {
    const replace = textInput("Replace", state.replaceText);
    replace.addEventListener("input", () => {
      state.replaceText = replace.value;
      save();
    });
    const all = button("⤷", "", () =>
      sendReplace(
        (results?.files ?? []).flatMap((group) =>
          surviving(group).map((match) => target(group.path, match)),
        ),
      ),
    );
    all.title = "Replace All";
    fields.push(div("replacerow", [replace, all]));
  }
  queryEl.replaceChildren(gutter, div("fields", fields));
};

const renderFilters = (): void => {
  const more = button("⋯", "", () => {
    state.showFilters = !state.showFilters;
    render();
  });
  more.title = "Toggle Author Filters";
  filterAreaEl.replaceChildren(div("filterbar", [more]));
  if (!state.showFilters) return;

  const datalist = document.createElement("datalist");
  datalist.id = "authors";
  for (const author of authors) {
    const option = document.createElement("option");
    option.value = author.slug;
    option.label = author.name;
    datalist.append(option);
  }
  const field = (
    caption: string,
    value: string,
    apply: (value: string) => void,
  ): HTMLElement => {
    const input = textInput("Author slugs, comma-separated", value);
    input.setAttribute("list", "authors");
    input.addEventListener("input", () => {
      apply(input.value);
      save();
      scheduleSearch();
    });
    const label = document.createElement("label");
    label.append(caption, input);
    return label;
  };
  filterAreaEl.append(
    div("filters", [
      field("authors to include", state.includeText, (value) => {
        state.includeText = value;
      }),
      field("authors to exclude", state.excludeText, (value) => {
        state.excludeText = value;
      }),
      datalist,
    ]),
  );
};

const renderResults = (): void => {
  errorEl.className = "regex-error";
  errorEl.replaceChildren(
    ...(results?.error === undefined ? [] : [results.error]),
  );
  termInput?.classList.toggle("error", results?.error !== undefined);
  summaryEl.className = "summary";
  resultsEl.className = "results";
  if (results === undefined || results.error !== undefined) {
    summaryEl.replaceChildren();
    resultsEl.replaceChildren();
    return;
  }
  const groups = results.files
    .map((group) => ({ group, matches: surviving(group) }))
    .filter(({ matches }) => matches.length > 0);
  const total = groups.reduce((sum, { matches }) => sum + matches.length, 0);
  summaryEl.textContent =
    total === 0
      ? "No results found."
      : `${results.truncated ? "The first " : ""}${total} ` +
        `${total === 1 ? "result" : "results"} in ${groups.length} ` +
        `${groups.length === 1 ? "edition" : "editions"}.`;
  resultsEl.replaceChildren(
    ...groups.flatMap(({ group, matches }) => renderGroup(group, matches)),
  );
};

const renderGroup = (group: FileGroup, matches: Match[]): HTMLElement[] => {
  const folded = collapsed.has(group.path);
  const head = div("filehead", [
    span("twisty", folded ? "▸" : "▾"),
    span("label", group.label),
    span("badge", `${matches.length}${group.truncated ? "+" : ""}`),
    div("actions", [
      action("⤷", "Replace All in This Edition", () =>
        sendReplace(matches.map((match) => target(group.path, match))),
      ),
    ]),
  ]);
  head.title = group.path;
  head.addEventListener("click", () => {
    if (folded) collapsed.delete(group.path);
    else collapsed.add(group.path);
    renderResults();
  });
  return folded
    ? [head]
    : [head, ...matches.map((match) => renderMatch(group.path, match))];
};

const renderMatch = (path: string, match: Match): HTMLElement => {
  const row = div("match", [
    div("preview", [
      span("", match.before),
      span("hl", clip(match.matchText)),
      span("", match.after),
    ]),
    div("actions", [
      action("⤷", "Replace", () => sendReplace([target(path, match)])),
      action("✕", "Dismiss", () => {
        dismissed.add(matchKey(path, match));
        renderResults();
      }),
    ]),
  ]);
  row.addEventListener("click", () =>
    post({
      type: "openMatch",
      path,
      line: match.line,
      start: match.start,
      end: match.end,
    }),
  );
  return row;
};

/** A displayed match never runs longer than a preview's worth (a regex like
 * `.*` matches whole paragraph lines; the verbatim text stays in the data). */
const clip = (text: string): string =>
  text.length > 80 ? `${text.slice(0, 80)}…` : text;

/* ------------------------------ DOM helpers ------------------------------ */

const post = (message: unknown): void => vscode.postMessage(message);

const onEnter = (input: HTMLInputElement, run: () => void): void => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") run();
  });
};

const toggle = (
  label: string,
  title: string,
  on: boolean,
  apply: (on: boolean) => void,
): HTMLButtonElement => {
  const element = button(label, on ? "on" : "", () => {
    apply(!on);
    save();
    render();
    sendSearch();
  });
  element.title = title;
  return element;
};

/** A hover action that must not also trigger its row's click. */
const action = (
  label: string,
  title: string,
  run: () => void,
): HTMLButtonElement => {
  const element = button(label, "", () => {});
  element.title = title;
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    run();
  });
  return element;
};

const button = (
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement => {
  const element = document.createElement("button");
  element.textContent = label;
  if (className !== "") element.className = className;
  element.addEventListener("click", onClick);
  return element;
};

const textInput = (placeholder: string, value: string): HTMLInputElement => {
  const element = document.createElement("input");
  element.type = "text";
  element.placeholder = placeholder;
  element.value = value;
  return element;
};

const div = (className: string, children: (Node | string)[]): HTMLElement => {
  const element = document.createElement("div");
  if (className !== "") element.className = className;
  element.append(...children);
  return element;
};

const span = (className: string, text: string): HTMLSpanElement => {
  const element = document.createElement("span");
  if (className !== "") element.className = className;
  element.textContent = text;
  return element;
};

/* ------------------------------- bootstrap ------------------------------- */

document.body.append(queryEl, filterAreaEl, errorEl, summaryEl, resultsEl);

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as
    | ({ type: "results" } & Results)
    | { type: "context"; authors: AuthorRow[] }
    | { type: "corpusChanged" }
    | { type: "prefill"; term: string };
  switch (message.type) {
    case "results":
      // Only the results area re-renders: rebuilding the query inputs here
      // would steal the caret from a term the user is still typing.
      results = message;
      collapsed = new Set();
      dismissed = new Set();
      renderResults();
      return;
    case "context":
      authors = message.authors;
      renderFilters();
      return;
    case "corpusChanged":
      if (state.term !== "") sendSearch();
      return;
    case "prefill":
      // The editor context menu's exact semantics: this word, whole and cased.
      state = {
        ...state,
        term: message.term,
        isRegex: false,
        caseSensitive: true,
        wholeWord: true,
      };
      render();
      sendSearch();
      return;
  }
});

render();
post({ type: "ready" });
if (state.term !== "") sendSearch();
