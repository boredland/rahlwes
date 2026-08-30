import { USER_AGENT } from "../lib/http";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

const FRONTEND = "https://collections.arolsen-archives.org/";
const WS = "https://collections-server.arolsen-archives.org/ITS-WS.asmx";

/**
 * Arolsen Archives — the largest collection on Nazi persecution and forced labour.
 * No documented API; this drives the same undocumented JSON backend (ITS-WS.asmx) the
 * official online archive uses. Authorized for internal use in service of research in the
 * name of NS victims (see PLAN §6).
 *
 * Protocol (verified live via captured XHR): the backend is a stateful ASP.NET
 * ScriptService keyed by a client-generated `uniqueId`, pinned to one node by load-balancer
 * cookies. Sequence per query:
 *   1. GET the frontend once to obtain the LB session cookies.
 *   2. POST BuildQueryGlobalForAngular {uniqueId,lang,archiveIds,strSearch,synSearch} -> {"d":true}
 *   3. POST GetPersonList {uniqueId,lang,rowNum,orderBy,orderType} -> {"d":[{DescId,LastName,...}]}
 * All calls must carry the same uniqueId + cookies to land on the same session.
 */
export const arolsenAdapter: ArchiveAdapter = {
  id: "arolsen",
  label: "Arolsen Archives",
  role: "records",

  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    if (!q.name) return { records: [] };

    const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const baseHeaders = {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": USER_AGENT,
      origin: "https://collections.arolsen-archives.org",
      referer: FRONTEND,
    };

    // BuildQuery creates the server-side session; its Set-Cookie (ASP.NET_SessionId + the
    // TS load-balancer cookie) MUST be replayed on GetPersonList or the query state is lost
    // and the list comes back empty. Workers expose response cookies via getSetCookie().
    const build = await callWsRaw(
      "BuildQueryGlobalForAngular",
      { uniqueId, lang: "en", archiveIds: [], strSearch: q.name, synSearch: true },
      baseHeaders,
      ctx.signal,
    );
    if (build.data !== true) return { records: [], degraded: true };

    const headers = build.cookie ? { ...baseHeaders, cookie: build.cookie } : baseHeaders;
    const rows = await callWs<ArolsenPerson[]>(
      "GetPersonList",
      { uniqueId, lang: "en", rowNum: 0, orderBy: "LastName", orderType: "asc" },
      headers,
      ctx.signal,
    );

    // Arolsen's phonetic search returns a large (~1000), alphabetically-sorted fuzzy block
    // where the actual matches for the query are scattered and buried under soundalikes.
    // Re-rank by relevance to the query, drop rows that don't match at all, then paginate
    // within the re-ranked set. `total` therefore reports the relevant count, not the raw
    // phonetic dump size.
    const tokens = (q.name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2);
    const seen = new Set<string>();
    const ranked = (rows ?? [])
      .filter((p) => {
        // Collapse exact duplicate document records (same DescId) the backend repeats.
        const key = p.DescId ?? String(p.ObjId ?? "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((p) => ({ p, score: scoreRecord(tokens, p) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const offset = q.cursor ? Number(q.cursor) : 0;
    const records = ranked.slice(offset, offset + q.limit).map((x) => toRecord(x.p));
    const cursor = offset + q.limit < ranked.length ? String(offset + q.limit) : undefined;
    return { records, total: ranked.length, cursor };
  },
};

/**
 * Relevance of one Arolsen person row to the query tokens. Surname weighs most, then maiden
 * name, then given name. Arolsen garbles some characters as `?` (e.g. "?EISS" for "WEISS");
 * we still match on the readable remainder so real hits aren't lost. Zero means no token
 * matched — those rows are the phonetic noise we drop.
 */
function scoreRecord(tokens: string[], p: ArolsenPerson): number {
  if (tokens.length === 0) return 0;
  const surname = (p.LastName ?? "").toLowerCase();
  const given = (p.FirstName ?? "").toLowerCase();
  const maiden = (p.MaidenName ?? "").toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    score += Math.max(fieldScore(tok, surname), 0.9 * fieldScore(tok, maiden), 0.6 * fieldScore(tok, given));
  }
  return score;
}

/** Best per-word match of `token` within a name field, tolerant of Arolsen's `?` garbling. */
function fieldScore(token: string, field: string): number {
  let best = 0;
  for (const word of field.split(/\s+/)) {
    if (!word) continue;
    if (word === token) best = Math.max(best, 100);
    else if (word.startsWith(token)) best = Math.max(best, 60);
    else if (word.includes(token)) best = Math.max(best, 40);
    else {
      // Garbled word (e.g. "?eiss"): match if its readable remainder sits inside the token.
      const clean = word.replace(/\?/g, "");
      if (clean.length >= 3 && token.includes(clean)) best = Math.max(best, 45);
    }
  }
  return best;
}

/** Row shape from ITS-WS.asmx/GetPersonList (keys per the frontend's personDisplayedColumns). */
interface ArolsenPerson {
  ObjId?: number;
  DescId?: string;
  LastName?: string;
  FirstName?: string;
  MaidenName?: string;
  PlaceBirth?: string;
  Dob?: string;
  Date_of_decease?: string;
  PrisonerNumber?: string;
  Nationality?: string;
  Place_of_incarceration?: string;
  Last_residence_town?: string;
  Signature?: string;
}

interface WsRawResult<T> {
  data: T | null;
  cookie?: string;
}

/** Like callWs, but also returns the session cookies the response set, for replay. */
async function callWsRaw<T>(
  method: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<WsRawResult<T>> {
  const res = await fetch(`${WS}/${method}`, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`arolsen ${method} -> HTTP ${res.status}`);
  const setCookies = res.headers.getSetCookie();
  const cookie = setCookies.length ? setCookies.map((c) => c.split(";")[0]!.trim()).join("; ") : undefined;
  const json = (await res.json()) as { d?: T };
  return { data: json.d ?? null, cookie };
}

async function callWs<T>(
  method: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<T | null> {
  const res = await fetch(`${WS}/${method}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`arolsen ${method} -> HTTP ${res.status}`);
  const json = (await res.json()) as { d?: T };
  return json.d ?? null;
}

function toRecord(p: ArolsenPerson): ArchiveRecord {
  const full = [p.FirstName, p.LastName].filter((v) => v && v.trim()).join(" ").trim();
  const descId = p.DescId?.trim();
  const decease = p.Date_of_decease?.trim();
  const notes = [
    p.PrisonerNumber ? `Prisoner no. ${p.PrisonerNumber}` : null,
    p.Place_of_incarceration ? `Incarceration: ${p.Place_of_incarceration}` : null,
    p.Nationality ? `Nationality: ${p.Nationality}` : null,
    "Sensitive persecution record — Arolsen Archives access terms apply.",
  ].filter(Boolean);
  return {
    source: "arolsen",
    sourceId: descId || String(p.ObjId ?? crypto.randomUUID()),
    personName: full || undefined,
    role: "victim",
    birth: p.Dob || p.PlaceBirth ? { date: p.Dob || undefined, place: p.PlaceBirth || undefined } : undefined,
    death: decease ? { date: decease } : undefined,
    documentType: p.Signature?.trim() || "Persecution record",
    holdingInstitution: "Arolsen Archives",
    reference: p.PrisonerNumber?.trim() || undefined,
    landingUrl: descId ? `https://collections.arolsen-archives.org/en/document/${descId}` : FRONTEND,
    preview: [p.Signature?.trim(), p.Place_of_incarceration?.trim(), p.Last_residence_town?.trim()].filter(Boolean).join(" · ") || undefined,
    accessNote: notes.join(" · "),
  };
}
