/**
 * Fetching a TCP transcription's TEI-XML — the `TeiSource` the import flow
 * declares. The Text Creation Partnership publishes one GitHub repository per
 * text, the file named after the id on the `master` branch, so a plain `fetch`
 * of the raw URL is the whole implementation; no SDK, no token. A 404 means
 * that id has no repository, which is expected for part of the catalogue — it
 * is reported as such rather than retried on another branch.
 */

import { type TeiSource, tcpXmlUrl } from "../../core/authoring/importTcp.ts";

/** A `TeiSource` backed by raw.githubusercontent.com. */
export const tcpTextSource: TeiSource = async (id) => {
  try {
    const res = await fetch(tcpXmlUrl(id));
    if (res.status === 404) {
      return {
        ok: false,
        reason: "notFound",
        detail: `${id} has no repository in the TCP's GitHub organisation.`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "network",
        detail: `GitHub answered ${res.status}.`,
      };
    }
    return { ok: true, xml: await res.text() };
  } catch (error) {
    return {
      ok: false,
      reason: "network",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};
