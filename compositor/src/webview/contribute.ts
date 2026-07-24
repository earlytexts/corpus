/**
 * The Contribute panel's front-end: a framework-free DOM app that shows the
 * contributor one situation at a time and the one or two things they can do
 * about it. It holds no workflow logic — the extension posts a finished scene
 * and the webview renders it — and no git vocabulary: the words here are the
 * ones a contributor would use about their own work.
 *
 * The body is rebuilt only when the situation itself changes. Everything that
 * changes more often (the list of changed files, the busy message, whether a
 * button can be pressed) is updated in place, so a description being typed
 * never loses the caret to a file being saved in the editor.
 *
 * The wire shapes are declared locally: the data crosses the postMessage
 * boundary as plain JSON, so the webview needs the structure, not the modules
 * that derived it. The imperative bootstrap sits at the foot of the file so
 * every const arrow it calls is already defined.
 */

/* -------------------------------- shapes --------------------------------- */

type ChangeRow = {
  path: string;
  label: string;
  change: "added" | "modified" | "deleted";
};

type Submission = {
  branch: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
};

type Scene =
  | { kind: "loading" }
  | { kind: "noRepo" }
  | { kind: "signedOut"; files: ChangeRow[] }
  | { kind: "clean" }
  | { kind: "editing"; files: ChangeRow[] }
  | { kind: "unfinished"; title: string; files: ChangeRow[] }
  | { kind: "sent"; submission: Submission; files: ChangeRow[] }
  | {
      kind: "decided";
      submission: Submission;
      accepted: boolean;
      files: ChangeRow[];
    };

type ViewMessage = {
  type: "view";
  scene: Scene;
  busy?: string;
  error?: string;
};

/** What survives the panel being hidden: what the contributor has typed. */
type State = { description: string; notes: string };

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => State | undefined;
  setState: (state: State) => void;
};
declare const acquireVsCodeApi: () => VsCodeApi;

const vscode = acquireVsCodeApi();

let state: State = vscode.getState() ?? { description: "", notes: "" };

let scene: Scene = { kind: "loading" };
let busy: string | undefined;

/* -------------------------------- regions -------------------------------- */

const errorEl = document.createElement("div");
const busyEl = document.createElement("div");
const bodyEl = document.createElement("div");

/** The body is rebuilt only when the situation changes; these pieces of it are
 * updated in place on every message. */
let renderedKind: string | undefined;
let headingEl: HTMLElement | undefined;
let heading = "Your changes";
let filesEl: HTMLElement | undefined;
let emptyNote: string | undefined;
let submitEl: HTMLButtonElement | undefined;
let descriptionEl: HTMLInputElement | undefined;
let tidyEl: HTMLButtonElement | undefined;

const render = (message: ViewMessage): void => {
  scene = message.scene;
  busy = message.busy;
  errorEl.className = "error";
  errorEl.replaceChildren(
    ...(message.error === undefined ? [] : [message.error]),
  );
  if (scene.kind !== renderedKind) {
    renderedKind = scene.kind;
    headingEl = undefined;
    filesEl = undefined;
    emptyNote = undefined;
    submitEl = undefined;
    descriptionEl = undefined;
    tidyEl = undefined;
    bodyEl.replaceChildren(...buildBody());
  }
  update();
};

/* ------------------------------ the scenes ------------------------------- */

const buildBody = (): HTMLElement[] => {
  switch (scene.kind) {
    case "loading":
      return [note("Reading your copy of the corpus…")];
    case "noRepo":
      return [
        note(
          "This folder is not a copy of the corpus, so there is nothing to " +
            "send. Set the corpus up and the compositor will look after the " +
            "rest.",
        ),
        primary("Set up the corpus", () => post({ type: "setup" })),
      ];
    case "signedOut":
      return [
        note(
          "Sign in to GitHub to send your work to the Early Text Centre, and " +
            "to see what has become of anything you have already sent.",
        ),
        primary("Sign in to GitHub", () => post({ type: "signIn" })),
        ...fileList("Your changes"),
      ];
    case "clean":
      return [
        note("You have no unsent changes."),
        secondary("Get the latest corpus", () => post({ type: "getLatest" })),
      ];
    case "editing":
      return [...fileList("Your changes"), ...sendForm("Send for review")];
    case "unfinished":
      return [
        warning(
          `Your last submission — “${scene.title}” — did not finish sending. ` +
            `Nothing has been lost; try again below.`,
        ),
        ...fileList("Your changes"),
        ...sendForm("Finish sending", { prefill: scene.title }),
      ];
    case "sent":
      return [
        submissionCard(scene.submission, "Waiting for review"),
        ...fileList(
          "New changes since you sent it",
          "Anything else you change will be added to this submission.",
        ),
        ...sendForm("Add to your submission", { action: "addTo" }),
      ];
    case "decided":
      return [
        submissionCard(
          scene.submission,
          scene.accepted
            ? "Accepted into the corpus"
            : "Closed without being accepted",
          scene.accepted,
        ),
        ...fileList("Your changes since"),
        ...sendForm("Send as a new submission"),
        tidyButton(),
      ];
  }
};

/** The changed-file list and its heading, both filled in by `update`. */
const fileList = (title: string, whenEmpty?: string): HTMLElement[] => {
  heading = title;
  emptyNote = whenEmpty;
  headingEl = div("heading", []);
  filesEl = div("files", []);
  return [headingEl, filesEl];
};

/**
 * The description and the button that sends it. The description is the one
 * thing a contributor must supply: it becomes the title the editors read, and
 * the name their work is filed under.
 */
const sendForm = (
  label: string,
  options: { prefill?: string; action?: "send" | "addTo" } = {},
): HTMLElement[] => {
  const action = options.action ?? "send";
  if (state.description === "" && options.prefill !== undefined) {
    state.description = options.prefill;
  }

  const description = input(
    "Corrected the long-s errors in THN 1.3.14",
    state.description,
  );
  description.addEventListener("input", () => {
    state.description = description.value;
    save();
    update();
  });
  descriptionEl = description;

  const rows: HTMLElement[] = [
    field(
      action === "send" ? "What did you do?" : "What have you added?",
      description,
    ),
  ];

  if (action === "send") {
    const notes = document.createElement("textarea");
    notes.rows = 2;
    notes.placeholder =
      "Which printing you checked against, anything you were unsure of…";
    notes.value = state.notes;
    notes.addEventListener("input", () => {
      state.notes = notes.value;
      save();
    });
    rows.push(field("Notes for the editors (optional)", notes));
  }

  submitEl = primary(label, () => {
    const description = state.description.trim();
    if (description === "") return;
    post(
      action === "send"
        ? { type: "send", description, notes: state.notes.trim() }
        : { type: "addTo", description },
    );
    // What was typed belongs to the submission just made, not the next one.
    state = { description: "", notes: "" };
    save();
  });
  rows.push(submitEl);
  return [div("form", rows)];
};

/** Offered once a settled submission has nothing left hanging off it. */
const tidyButton = (): HTMLButtonElement => {
  tidyEl = secondary("Start something new", () => post({ type: "tidyUp" }));
  return tidyEl;
};

const submissionCard = (
  submission: Submission,
  status: string,
  celebrate = false,
): HTMLElement =>
  div("card", [
    div("card-title", [
      celebrate ? `🎉 ${submission.title}` : submission.title,
    ]),
    div("card-status", [`${status} · sent ${when(submission.createdAt)}`]),
    button("See the conversation on GitHub", "link", () =>
      post({ type: "openSubmission", url: submission.url }),
    ),
  ]);

/* ------------------------------- updating -------------------------------- */

/** Everything that changes more often than the situation does. */
const update = (): void => {
  const files = "files" in scene ? scene.files : [];
  // Left genuinely empty when there is nothing to head, so the stylesheet's
  // :not(:empty) rule drops its margins too.
  if (files.length === 0) headingEl?.replaceChildren();
  else headingEl?.replaceChildren(`${heading} (${files.length})`);
  if (filesEl !== undefined) {
    filesEl.replaceChildren(
      ...(files.length === 0
        ? emptyNote === undefined
          ? []
          : [note(emptyNote)]
        : files.map(fileRow)),
    );
  }
  if (submitEl !== undefined) {
    // An interrupted send is the one thing that can be sent with nothing
    // changed on disk: its work is already set aside, waiting to go.
    const needsFiles = scene.kind !== "unfinished";
    submitEl.disabled =
      busy !== undefined ||
      state.description.trim() === "" ||
      (needsFiles && files.length === 0);
  }
  if (descriptionEl !== undefined) descriptionEl.disabled = busy !== undefined;
  if (tidyEl !== undefined) {
    // Clearing away a settled submission moves the files underneath the
    // contributor, so it waits until they have nothing unsent.
    tidyEl.hidden = files.length > 0;
    tidyEl.disabled = busy !== undefined;
  }
  document.body.classList.toggle("busy", busy !== undefined);
  busyEl.className = "busy";
  busyEl.replaceChildren(...(busy === undefined ? [] : [busy]));
};

const fileRow = (file: ChangeRow): HTMLElement => {
  const mark =
    file.change === "added" ? "✚" : file.change === "deleted" ? "✕" : "✎";
  const row = div("file", [
    span(`mark ${file.change}`, mark),
    span("label", file.label),
    div("actions", [
      action("⇄", "See what changed", () =>
        post({ type: "compare", path: file.path }),
      ),
      action("↺", "Undo your changes to this file", () =>
        post({ type: "discard", path: file.path }),
      ),
    ]),
  ]);
  row.title = file.path;
  row.addEventListener("click", () =>
    post({
      // A deleted file cannot be opened, so show what was lost instead.
      type: file.change === "deleted" ? "compare" : "open",
      path: file.path,
    }),
  );
  return row;
};

/** "20 July", or "today" — a date a contributor recognises. */
const when = (iso: string): string => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return sameDay
    ? "today"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
};

/* ------------------------------ DOM helpers ------------------------------ */

const post = (message: unknown): void => vscode.postMessage(message);

const save = (): void => vscode.setState(state);

const note = (text: string): HTMLElement => div("note", [text]);

const warning = (text: string): HTMLElement => div("warning", [text]);

const field = (caption: string, control: HTMLElement): HTMLElement => {
  const label = document.createElement("label");
  label.append(caption, control);
  return label;
};

const input = (placeholder: string, value: string): HTMLInputElement => {
  const element = document.createElement("input");
  element.type = "text";
  element.placeholder = placeholder;
  element.value = value;
  return element;
};

const primary = (label: string, onClick: () => void): HTMLButtonElement =>
  button(label, "primary", onClick);

const secondary = (label: string, onClick: () => void): HTMLButtonElement =>
  button(label, "secondary", onClick);

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

document.body.append(errorEl, busyEl, bodyEl);

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as ViewMessage;
  if (message.type === "view") render(message);
});

post({ type: "ready" });
