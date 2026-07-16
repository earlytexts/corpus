/**
 * ensureFork's branching, over a fake GitHubClient: an existing fork is reused,
 * a missing one is created and polled until it appears, and a same-named repo
 * that is not our fork is refused. No network, no real delays.
 */

import { expect, test, vi } from "vitest";
import { ensureFork, type GitHubClient, type Repo } from "../src/git/github.ts";

const fork = (login: string): Repo => ({
  full_name: `${login}/corpus`,
  clone_url: `https://github.com/${login}/corpus.git`,
  fork: true,
  source: { full_name: "earlytexts/corpus" },
});

/** A client whose getRepo returns the queued responses in order. */
const fakeClient = (
  getRepoResponses: Array<Repo | undefined>,
): GitHubClient & { forks: number } => {
  const queue = [...getRepoResponses];
  const client = {
    forks: 0,
    getViewerLogin: () => Promise.resolve("ada"),
    getRepo: () => Promise.resolve(queue.shift()),
    createFork: () => {
      client.forks++;
      return Promise.resolve();
    },
  };
  return client;
};

const noSleep = (): Promise<void> => Promise.resolve();
const noReport = (): void => {};

test("reuses an existing fork without creating one", async () => {
  const gh = fakeClient([fork("ada")]);
  const url = await ensureFork(gh, "ada", noReport, noSleep);
  expect(url).toBe("https://github.com/ada/corpus.git");
  expect(gh.forks).toBe(0);
});

test("creates a fork when none exists, then polls until it appears", async () => {
  // 404, then still-not-ready, then the fork materialises.
  const gh = fakeClient([undefined, undefined, fork("ada")]);
  const url = await ensureFork(gh, "ada", noReport, noSleep);
  expect(url).toBe("https://github.com/ada/corpus.git");
  expect(gh.forks).toBe(1);
});

test("refuses a same-named repo that is not a fork of the corpus", async () => {
  const notOurFork: Repo = {
    full_name: "ada/corpus",
    clone_url: "https://github.com/ada/corpus.git",
    fork: false,
  };
  const gh = fakeClient([notOurFork]);
  await expect(ensureFork(gh, "ada", noReport, noSleep)).rejects.toThrow(
    /not a fork of earlytexts\/corpus/,
  );
  expect(gh.forks).toBe(0);
});

test("refuses a fork of some other repository with the same name", async () => {
  const otherFork: Repo = {
    full_name: "ada/corpus",
    clone_url: "https://github.com/ada/corpus.git",
    fork: true,
    source: { full_name: "someone-else/corpus" },
  };
  const gh = fakeClient([otherFork]);
  await expect(ensureFork(gh, "ada", noReport, noSleep)).rejects.toThrow(
    /not a fork of earlytexts\/corpus/,
  );
});

test("gives up after the poll budget is exhausted", async () => {
  // Never appears: createFork succeeds but every getRepo returns undefined.
  const gh = fakeClient(Array<undefined>(40).fill(undefined));
  const report = vi.fn();
  await expect(ensureFork(gh, "ada", report, noSleep)).rejects.toThrow(
    /taking longer than expected/,
  );
  expect(report).toHaveBeenCalledWith(
    "Creating your copy of the corpus on GitHub…",
  );
});
