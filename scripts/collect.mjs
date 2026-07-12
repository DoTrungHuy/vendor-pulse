import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicData = path.join(root, "public", "data");
const sourceFile = path.join(root, "data", "sources.json");
const fiveHours = 5 * 60 * 60 * 1000;
const userAgent = "agent-pulse-collector/1.0 (+https://github.com/agent-pulse; free public docs fetch)";

export const RSS_SIGNAL_PATTERN = /\b(GPT[-\s.]?\d|gpt-oss|o[1-9]\b|Codex|Claude|Gemini|model|deprecat|retir|shutdown|sunset|generally available|introducing|released|launch)\b/i;
export const RELEASE_SIGNAL_PATTERN = /(released|launch|introduc|available|deprecated|deprecat|retir|shut\s*down|sunset|发布|上线|弃用|下线)/i;
export const POLICY_SIGNAL_PATTERN = /(deprecat|retir|shut\s*down|sunset|migration|end of (life|support)|no longer available|will be removed|弃用|下线|迁移)/i;

export function getFiveHourSlot(date = new Date()) {
  return new Date(Math.floor(date.getTime() / fiveHours) * fiveHours).toISOString();
}

export function mergeEvents(existing, additions) {
  const byKey = new Map();
  for (const rawEvent of [...existing, ...additions]) {
    const confidence = rawEvent.confidence === "verified" ? "verified" : "needs_review";
    const canonicalKey = canonicalEventKey({ ...rawEvent, confidence });
    const parsedEffectiveDate = rawEvent.type === "deprecation" ? extractEffectiveDateFromText(rawEvent.title) : null;
    const event = {
      ...rawEvent,
      id: canonicalKey,
      canonical_key: canonicalKey,
      confidence,
      published_at: rawEvent.published_at ?? ((rawEvent.type === "release" || rawEvent.type === "model") && confidence === "verified" ? rawEvent.occurred_at : null),
      effective_at: rawEvent.type === "deprecation" ? parsedEffectiveDate?.toISOString() || null : rawEvent.effective_at || null,
    };
    const previous = byKey.get(canonicalKey);
    if (!previous) {
      byKey.set(canonicalKey, {
        ...event,
        first_seen_at: event.first_seen_at || event.occurred_at,
        last_seen_at: event.last_seen_at || event.occurred_at,
      });
      continue;
    }

    const firstSeen = [previous.first_seen_at, event.first_seen_at, previous.occurred_at, event.occurred_at]
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0];
    const lastSeen = [previous.last_seen_at, event.last_seen_at, previous.occurred_at, event.occurred_at]
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];
    const preferred = previous.confidence === "verified" || event.confidence !== "verified" ? previous : event;
    byKey.set(canonicalKey, {
      ...preferred,
      id: canonicalKey,
      canonical_key: canonicalKey,
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      occurred_at: preferred.confidence === "needs_review" ? firstSeen : preferred.occurred_at,
    });
  }
  return [...byKey.values()].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
}

export function normalizeEventTitle(value) {
  return String(value || "")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function canonicalEventKey(event) {
  let titleKey = normalizeEventTitle(event.title).replace(/^[^:]+:\s*/, "").replace(/^model status\s+/, "");
  if (event.type === "deprecation") {
    const lifecycleSubject = titleKey.match(/(.+?)\s+will be retired on/i)?.[1]
      || titleKey.match(/fast mode for ([^,]+),\s*with removal/i)?.[1]
      || titleKey.match(/we(?:'|’)ve retired the (.+?) model/i)?.[1];
    if (lifecycleSubject) {
      const effectiveDate = event.effective_at
        || extractEffectiveDateFromText(event.title)?.toISOString()
        || (event.confidence === "verified" ? event.occurred_at : null)
        || "undated";
      titleKey = `${lifecycleSubject}|${String(effectiveDate).slice(0, 10)}`;
    }
  }
  return eventId([
    "event",
    event.type || "unknown",
    event.item_id || "unknown",
    event.feed_id || "primary",
    shortHash(titleKey),
  ]);
}

export function pruneSnapshots(points, now = new Date()) {
  const boundary = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  const recent = points.filter((point) => new Date(point.captured_at).getTime() >= boundary);
  const oldDaily = new Map();
  points.filter((point) => new Date(point.captured_at).getTime() < boundary).forEach((point) => oldDaily.set(point.captured_at.slice(0, 10), point));
  return [...oldDaily.values(), ...recent].sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
}

export function calculateDelta(points, stars, durationMs, now = new Date()) {
  if (stars === null || !points.length) return null;
  const cutoff = now.getTime() - durationMs;
  const baseline = [...points].reverse().find((point) => new Date(point.captured_at).getTime() <= cutoff);
  return baseline ? stars - baseline.stars : null;
}

export function normalizeFeeds(source) {
  if (Array.isArray(source.feeds) && source.feeds.length) {
    return source.feeds.map((feed) => ({
      id: feed.id,
      label: feed.label || feed.id,
      url: feed.url || feed.fetch_url || source.source_url,
      kind: feed.kind === "deprecation" || feed.kind === "policy" ? "deprecation" : "model",
      parser: feed.parser || "dated-sections",
      priority: Number.isFinite(feed.priority) ? feed.priority : 2,
      required: feed.required !== false,
    }));
  }
  return [{
    id: "primary",
    label: "Primary",
    url: source.fetch_url || source.source_url,
    kind: "model",
    parser: source.parser || "dated-sections",
    priority: 1,
    required: true,
  }];
}

export function classifyEventType(title, preferredKind = "model") {
  if (preferredKind === "deprecation" || POLICY_SIGNAL_PATTERN.test(title)) return "deprecation";
  return "model";
}

export function parseDatedModelEvent(content) {
  return parseDatedModelEvents(content, { limit: 1 })[0] || null;
}

export function parseDatedModelEvents(content, { limit = 5 } = {}) {
  const text = stripMarkup(content);
  const patterns = [
    /(?:^|\n)([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s*\n+([\s\S]*?)(?=\n[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*\n|$)/g,
    /(?:^|\n)((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\s*\n+([\s\S]*?)(?=\n(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\s*\n|$)/gi,
    /(?:^|\n)(\d{4}-\d{2}-\d{2})\s*\n+([\s\S]*?)(?=\n\d{4}-\d{2}-\d{2}\s*\n|$)/g,
  ];
  const events = [];
  for (const pattern of patterns) {
    for (const section of text.matchAll(pattern)) {
      const date = parseFlexibleDate(section[1]);
      if (!date) continue;
      const body = section[2].trim();
      const sentence = body
        .split(/(?<=[.!?。])\s+|\n+/)
        .map((entry) => entry.replace(/^[-•*#\s]+/, "").trim())
        .find((entry) => entry.length > 12 && RELEASE_SIGNAL_PATTERN.test(entry));
      if (!sentence) continue;
      const type = classifyEventType(sentence);
      const effectiveDate = type === "deprecation" ? extractEffectiveDateFromText(sentence) : null;
      events.push({
        occurred_at: date.toISOString(),
        published_at: date.toISOString(),
        effective_at: effectiveDate?.toISOString() || null,
        title: sentence.slice(0, 220),
        type,
      });
      if (events.length >= limit) return events;
    }
    if (events.length) return events;
  }
  return events;
}

export function parseRssModelEvent(content) {
  return parseRssModelEvents(content, { limit: 1 })[0] || null;
}

export function parseRssModelEvents(content, { limit = 8 } = {}) {
  const decode = (value) => value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
  const items = [...content.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const events = [];
  for (const item of items) {
    const body = item[1];
    const title = decode(body.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const published = body.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
    const url = decode(body.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
    if (!title || !published || !Number.isFinite(new Date(published).getTime())) continue;
    if (!RSS_SIGNAL_PATTERN.test(title)) continue;
    const type = classifyEventType(title);
    const publishedAt = new Date(published).toISOString();
    const effectiveDate = type === "deprecation" ? extractEffectiveDateFromText(title) : null;
    events.push({
      occurred_at: publishedAt,
      published_at: publishedAt,
      effective_at: effectiveDate?.toISOString() || null,
      title,
      source_url: url || null,
      type,
    });
    if (events.length >= limit) break;
  }
  return events;
}

/** 只保留“某个模型要下线/迁移”的具体句子，丢掉术语表和页面套话 */
export function isConcreteDeprecation(title) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (text.length < 24 || text.length > 280) return false;

  const noise = [
    /see which .* are active/i,
    /this page lists/i,
    /current and recently retired models are listed/i,
    /api model name current state deprecated/i,
    /\bactive n\/a not sooner than\b/i,
    /shutdown date model \/ system recommended replacement/i,
    /upcoming deprecations(?:\s+upcoming deprecations|\s+are listed)/i,
    /all deprecations are listed below/i,
    /anthropic uses the following terms/i,
    /the following terms to describe/i,
    /\bactive:\s*the model is fully supported/i,
    /\blegacy:\s*the model will no longer/i,
    /\bdeprecated:\s*the model is still functional/i,
    /recommended for use/i,
    /overview\b/i,
    /table of contents/i,
    /copy page/i,
    /^previous models\b/i,
    /\bpalette\b/i,
    /\bhistory\b$/i,
  ];
  if (noise.some((pattern) => pattern.test(text))) return false;

  const hasAction = /(deprecat|retir|shutdown|shut down|sunset|no longer available|will be removed|migrate|end of (life|support)|下线|弃用|迁移)/i.test(text);
  const hasModel = /\b(gpt[-\s]?\d|o[1-9]\b|claude[-\s]?|gemini[-\s]?|imagen|sonnet|opus|haiku|flash|codex)\b/i.test(text);
  const hasDate = /\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text);

  // 必须有动作，且最好点名模型或带日期；纯“Deprecated”词条不够
  if (!hasAction) return false;
  if (!hasModel && !hasDate) return false;
  // 过短且像标签
  if (text.split(" ").length < 6 && !hasDate) return false;
  return true;
}

export function parseDeprecationsPage(content) {
  const text = stripMarkup(content)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/⌘K/g, " ");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const events = [];
  const seen = new Set();
  const modelIdPattern = /\b((?:gpt|o\d|claude|gemini|imagen)[a-z0-9._-]{2,}|sonnet|opus|haiku)\b/i;

  for (let index = 0; index < lines.length; index += 1) {
    const window = [lines[index], lines[index + 1], lines[index + 2]].filter(Boolean).join(" ");
    const compact = window
      .replace(/[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^(Copy page|See also|On this page)\s*/i, "")
      .trim();
    if (!isConcreteDeprecation(compact)) continue;

    const date = extractEffectiveDateFromText(compact) || extractDateFromText(compact) || extractDateFromText(lines[index - 1] || "") || extractDateFromText(lines[index + 1] || "");
    const key = compact.toLowerCase().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      occurred_at: (date || new Date()).toISOString(),
      published_at: null,
      effective_at: date?.toISOString() || null,
      title: compact.slice(0, 220),
      type: "deprecation",
      confidence: date && modelIdPattern.test(compact) ? "verified" : "needs_review",
    });
    if (events.length >= 8) break;
  }

  events.sort((a, b) => {
    const score = (item) => (item.confidence === "verified" ? 2 : 0) + (/\b20\d{2}\b/.test(item.title) ? 1 : 0);
    return score(b) - score(a);
  });

  return events.slice(0, 6);
}

export function parseAnthropicNews(content) {
  const text = stripMarkup(content);
  const events = [];
  const seen = new Set();

  const datedCards = [
    ...text.matchAll(/(Claude[^\n]{0,120})\n+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/gi),
    ...text.matchAll(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\n+((?:Introducing|Claude|Announcing)[^\n]{8,160})/gi),
  ];

  for (const match of datedCards) {
    let title;
    let date;
    if (/claude|introducing|announcing/i.test(match[1]) && parseFlexibleDate(match[2])) {
      title = match[1].trim();
      date = parseFlexibleDate(match[2]);
    } else {
      date = parseFlexibleDate(match[1]);
      title = match[2].trim();
    }
    if (!date || !title || title.length < 8) continue;
    if (!/claude|model|opus|sonnet|haiku|introducing|announcing/i.test(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      occurred_at: date.toISOString(),
      published_at: date.toISOString(),
      effective_at: null,
      title: title.slice(0, 220),
      type: classifyEventType(title),
    });
    if (events.length >= 5) break;
  }

  if (!events.length) {
    const fallback = text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /introducing claude|claude (opus|sonnet|haiku)/i.test(line) && line.length < 180);
    if (fallback) {
      events.push({
        occurred_at: new Date().toISOString(),
        published_at: null,
        effective_at: null,
        title: fallback.slice(0, 220),
        type: "model",
        confidence: "needs_review",
      });
    }
  }

  return events;
}

export function parseFeedContent(parser, content) {
  switch (parser) {
    case "rss-model":
      return parseRssModelEvents(content);
    case "dated-headings":
      return parseDatedModelEvents(content);
    case "dated-sections":
      return parseDatedModelEvents(content);
    case "deprecations-page":
      return parseDeprecationsPage(content);
    case "anthropic-news":
      return parseAnthropicNews(content);
    case "generic":
      return parseDatedModelEvents(content);
    default:
      return parseDatedModelEvents(content);
  }
}

function stripMarkup(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(h[1-6]|li|p|section|article|div|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseFlexibleDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) {
    const date = new Date(`${iso}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(`${raw} UTC`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function extractDateFromText(text) {
  if (!text) return null;
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return parseFlexibleDate(iso[1]);
  const long = text.match(/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/i);
  if (long) return parseFlexibleDate(long[1]);
  const dayMonth = text.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4})\b/i);
  if (dayMonth) return parseFlexibleDate(dayMonth[1]);
  return null;
}

function extractEffectiveDateFromText(text) {
  if (!text) return null;
  const datePattern = "((?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+20\\d{2}|20\\d{2}-\\d{2}-\\d{2})";
  const afterAction = new RegExp(`(?:shut\\s*down|retir(?:ed|ement)|remov(?:ed|al)|sunset|end of (?:life|support))[^.]{0,40}?(?:on\\s+)?${datePattern}`, "i").exec(text)?.[1];
  if (afterAction) return parseFlexibleDate(afterAction);
  const beforeAction = new RegExp(`${datePattern}[^.]{0,40}?(?:shut\\s*down|retir(?:ed|ement)|remov(?:ed|al)|sunset)`, "i").exec(text)?.[1];
  return beforeAction ? parseFlexibleDate(beforeAction) : null;
}

function shortHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function eventId(parts) {
  return parts.filter(Boolean).join(":");
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`Invalid JSON in ${path.relative(root, file)}: ${error.message}`);
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function request(url, previous = {}) {
  const parsedUrl = new URL(url);
  const isGitHub = parsedUrl.protocol === "https:" && parsedUrl.hostname === "api.github.com";
  const headers = {
    "user-agent": userAgent,
    accept: isGitHub ? "application/vnd.github+json" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (!isGitHub) headers["accept-language"] = "en-US,en;q=0.9";
  if (process.env.GITHUB_TOKEN && isGitHub) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (previous.etag) headers["if-none-match"] = previous.etag;
  if (previous.last_modified) headers["if-modified-since"] = previous.last_modified;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (response.status === 304) return { unchanged: true, headers: response.headers };
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return { body: await response.text(), headers: response.headers };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError;
}

function sourceState(previous, response, error, required = true) {
  const checkedAt = new Date().toISOString();
  return {
    status: error ? "error" : "ok",
    required,
    checked_at: checkedAt,
    last_success_at: error ? previous?.last_success_at || null : checkedAt,
    consecutive_failures: error ? (previous?.consecutive_failures || 0) + 1 : 0,
    etag: response?.headers?.get?.("etag") || previous?.etag || null,
    last_modified: response?.headers?.get?.("last-modified") || previous?.last_modified || null,
    content_hash: response?.body ? createHash("sha256").update(response.body).digest("hex") : previous?.content_hash || null,
    previous_hash: previous?.content_hash || null,
    error: error ? String(error.message || error) : null,
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function cadence(releases, now) {
  const recent = releases.filter((release) => new Date(release.published_at).getTime() >= now.getTime() - 30 * 86400000);
  const intervals = recent.slice(0, -1).map((release, index) => Math.abs(new Date(release.published_at) - new Date(recent[index + 1].published_at)) / 86400000);
  return { count: recent.length, median_days: median(intervals) };
}

function pickSignal(candidates, kind) {
  const filtered = candidates
    .filter((item) => item && (kind === "deprecation" ? item.type === "deprecation" : item.type !== "deprecation"))
    .sort((a, b) => {
      const priorityDiff = (a.priority ?? 2) - (b.priority ?? 2);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
    });
  return filtered[0] || null;
}

async function collectTool(source, oldTool, sourceStatuses, now) {
  const repoKey = `github:${source.id}:repo`;
  const releaseKey = `github:${source.id}:releases`;
  const npmKey = source.npm ? `npm:${source.id}` : null;
  let repo = null;
  let releases = [];
  let npm = oldTool?.npm || null;
  const errors = [];
  try {
    const result = await request(`https://api.github.com/repos/${source.repo}`, sourceStatuses[repoKey]);
    sourceStatuses[repoKey] = sourceState(sourceStatuses[repoKey], result, null, true);
    repo = result.unchanged ? oldTool : JSON.parse(result.body);
  } catch (error) {
    sourceStatuses[repoKey] = sourceState(sourceStatuses[repoKey], null, error, true);
    errors.push(error);
  }
  try {
    const result = await request(`https://api.github.com/repos/${source.repo}/releases?per_page=20`, sourceStatuses[releaseKey]);
    sourceStatuses[releaseKey] = sourceState(sourceStatuses[releaseKey], result, null, true);
    releases = result.unchanged ? [] : JSON.parse(result.body);
  } catch (error) {
    sourceStatuses[releaseKey] = sourceState(sourceStatuses[releaseKey], null, error, true);
    errors.push(error);
  }
  if (source.npm) {
    try {
      const [packageResult, downloadsResult] = await Promise.all([
        request(`https://registry.npmjs.org/${encodeURIComponent(source.npm)}/latest`, sourceStatuses[npmKey]),
        request(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(source.npm)}`),
      ]);
      sourceStatuses[npmKey] = sourceState(sourceStatuses[npmKey], packageResult, null, false);
      npm = packageResult.unchanged
        ? oldTool?.npm
        : {
            package: source.npm,
            version: JSON.parse(packageResult.body).version,
            weekly_downloads: JSON.parse(downloadsResult.body).downloads ?? null,
          };
    } catch (error) {
      sourceStatuses[npmKey] = sourceState(sourceStatuses[npmKey], null, error, false);
      errors.push(error);
    }
  }
  const latest = releases[0] || null;
  const stars = repo?.stargazers_count ?? oldTool?.stars ?? null;
  return {
    tool: {
      id: source.id,
      name: source.name,
      repo: source.repo,
      repo_url: `https://github.com/${source.repo}`,
      official_url: source.official_url,
      x_url: source.x_url,
      stars,
      stars_delta_24h: null,
      stars_delta_7d: null,
      latest_release: latest
        ? { tag: latest.tag_name, title: latest.name || latest.tag_name, published_at: latest.published_at, url: latest.html_url }
        : oldTool?.latest_release || null,
      release_cadence_30d: releases.length ? cadence(releases, now) : oldTool?.release_cadence_30d || { count: 0, median_days: null },
      npm,
      status: errors.length >= 2 ? "error" : errors.length ? "degraded" : "ok",
    },
    events: releases.map((release) => ({
      id: `release:${source.id}:${release.id}`,
      item_id: source.id,
      item_name: source.name,
      type: "release",
      title: `${source.name} ${release.name || release.tag_name}`,
      occurred_at: release.published_at,
      published_at: release.published_at,
      effective_at: null,
      source_url: release.html_url,
      provider: null,
      feed_id: null,
      confidence: "verified",
    })),
  };
}

async function collectFeed(source, feed, sourceStatuses) {
  const key = `model:${source.id}:${feed.id}`;
  const legacyKey = `model:${source.id}`;
  const previous = sourceStatuses[key] || (feed.id === "primary" || feed.id === "news-rss" || feed.id === "api-changelog" ? sourceStatuses[legacyKey] : null) || {};
  try {
    const result = await request(feed.url, previous);
    const state = sourceState(previous, result, null, feed.required);
    const normalizedHash = result.body
      ? createHash("sha256").update(stripMarkup(result.body)).digest("hex")
      : previous.content_hash || null;
    state.content_hash = normalizedHash;
    state.previous_hash = previous.content_hash || null;
    state.normalized = true;
    state.feed_id = feed.id;
    state.feed_label = feed.label;
    state.kind = feed.kind;
    sourceStatuses[key] = state;

    if (result.unchanged) {
      return { feed, status: "ok", signals: [], reviewEvent: null, state };
    }

    const parsed = parseFeedContent(feed.parser, result.body).map((item) => ({
      ...item,
      type: item.type || classifyEventType(item.title, feed.kind),
      source_url: item.source_url || feed.url,
      feed_id: feed.id,
      priority: feed.priority,
      confidence: item.confidence || "verified",
    }));

    const changed = Boolean(previous.normalized && normalizedHash && normalizedHash !== previous.content_hash);
    const reviewEvent = !parsed.length && changed
      ? {
          occurred_at: new Date().toISOString(),
          published_at: null,
          effective_at: null,
          title: `${source.name} ${feed.label} 内容变化，待核验`,
          type: "source_changed",
          source_url: feed.url,
          feed_id: feed.id,
          priority: feed.priority,
          confidence: "needs_review",
        }
      : null;

    return { feed, status: "ok", signals: parsed, reviewEvent, state };
  } catch (error) {
    sourceStatuses[key] = {
      ...sourceState(previous, null, error, feed.required),
      feed_id: feed.id,
      feed_label: feed.label,
      kind: feed.kind,
    };
    return { feed, status: "error", signals: [], reviewEvent: null, state: sourceStatuses[key] };
  }
}

async function collectModel(source, oldModel, sourceStatuses) {
  const feeds = normalizeFeeds(source);
  const feedResults = [];
  for (const feed of feeds) {
    // Sequential per model keeps free-tier politeness; models still run in parallel.
    feedResults.push(await collectFeed(source, feed, sourceStatuses));
  }

  const signals = feedResults.flatMap((result) => result.signals);
  const reviewEvents = feedResults.map((result) => result.reviewEvent).filter(Boolean);
  const verifiedSignals = signals.filter((signal) => signal.confidence !== "needs_review");
  const reviewSignals = signals.filter((signal) => signal.confidence === "needs_review");
  const latestModelSignal = pickSignal(verifiedSignals, "model") || (oldModel?.latest_model
    ? { ...oldModel.latest_model, type: "model", priority: 9 }
    : pickSignal(reviewSignals, "model"));
  const latestPolicySignal = pickSignal(verifiedSignals, "deprecation") || (oldModel?.latest_policy
    ? { ...oldModel.latest_policy, type: "deprecation", priority: 9 }
    : pickSignal(reviewSignals, "deprecation"));

  const feedStatuses = feedResults.map((result) => ({
    id: result.feed.id,
    label: result.feed.label,
    kind: result.feed.kind,
    required: result.feed.required,
    url: result.feed.url,
    status: result.status,
    checked_at: result.state?.checked_at || null,
    error: result.state?.error || null,
  }));

  const healthy = feedStatuses.filter((feed) => feed.status === "ok").length;
  const status = healthy === 0 ? "error" : healthy < feedStatuses.length ? "degraded" : "ok";

  const title = latestModelSignal?.title || oldModel?.title || "官方发布说明页已建立基线";
  const occurred_at = latestModelSignal?.occurred_at || oldModel?.occurred_at || null;

  const model = {
    id: source.id,
    name: source.name,
    provider: source.provider,
    source_url: latestModelSignal?.source_url || source.source_url,
    title,
    occurred_at,
    status,
    latest_model: latestModelSignal
      ? {
          title: latestModelSignal.title,
          occurred_at: latestModelSignal.occurred_at,
          published_at: latestModelSignal.published_at || latestModelSignal.occurred_at,
          effective_at: latestModelSignal.effective_at || null,
          source_url: latestModelSignal.source_url,
          feed_id: latestModelSignal.feed_id || null,
          confidence: latestModelSignal.confidence || "verified",
        }
      : oldModel?.latest_model || null,
    latest_policy: latestPolicySignal
      ? {
          title: latestPolicySignal.title,
          occurred_at: latestPolicySignal.occurred_at,
          published_at: latestPolicySignal.published_at || null,
          effective_at: latestPolicySignal.effective_at || null,
          source_url: latestPolicySignal.source_url,
          feed_id: latestPolicySignal.feed_id || null,
          confidence: latestPolicySignal.confidence || "verified",
        }
      : oldModel?.latest_policy || null,
    feeds: feedStatuses,
  };

  const events = [
    ...signals.map((signal) => ({
      id: eventId([
        signal.type,
        source.id,
        signal.feed_id,
        signal.occurred_at,
        shortHash(signal.title),
      ]),
      item_id: source.id,
      item_name: source.name,
      type: signal.type,
      title: `${source.name}: ${signal.title}`,
      occurred_at: signal.occurred_at,
      published_at: signal.published_at || (signal.type === "deprecation" ? null : signal.occurred_at),
      effective_at: signal.effective_at || null,
      source_url: signal.source_url,
      provider: source.provider,
      feed_id: signal.feed_id || null,
      confidence: signal.confidence || "verified",
    })),
    ...reviewEvents.map((signal) => ({
      id: eventId(["source", source.id, signal.feed_id, shortHash(signal.title + signal.occurred_at)]),
      item_id: source.id,
      item_name: source.name,
      type: "source_changed",
      title: signal.title,
      occurred_at: signal.occurred_at,
      published_at: null,
      effective_at: null,
      source_url: signal.source_url,
      provider: source.provider,
      feed_id: signal.feed_id || null,
      confidence: "needs_review",
    })),
  ];

  return { model, events };
}

function configuredSourceKeys(sources) {
  const keys = new Set();
  for (const source of sources.tools || []) {
    keys.add(`github:${source.id}:repo`);
    keys.add(`github:${source.id}:releases`);
    if (source.npm) keys.add(`npm:${source.id}`);
  }
  for (const source of sources.models || []) {
    for (const feed of normalizeFeeds(source)) keys.add(`model:${source.id}:${feed.id}`);
  }
  return keys;
}

export function shouldSkipCollection(previousStatus, now = new Date(), cooldownMinutes = 0) {
  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes <= 0) return false;
  const previous = new Date(previousStatus?.checked_at || previousStatus?.generated_at || 0).getTime();
  return Number.isFinite(previous) && previous > 0 && now.getTime() - previous < cooldownMinutes * 60_000;
}

export function summarizeHealth(sourceStatuses) {
  const entries = Object.entries(sourceStatuses);
  const required = entries.filter(([, source]) => source.required !== false);
  const failed = entries.filter(([, source]) => source.status === "error");
  const requiredFailed = required.filter(([, source]) => source.status === "error");
  const requiredHealthy = required.filter(([, source]) => source.status === "ok");
  const overall = required.length > 0 && requiredHealthy.length === 0
    ? "error"
    : failed.length > 0
      ? "degraded"
      : "ok";
  return {
    overall,
    counts: {
      total: entries.length,
      healthy: entries.length - failed.length,
      failed: failed.length,
      required: required.length,
      required_healthy: requiredHealthy.length,
      required_failed: requiredFailed.length,
    },
    failed_sources: failed.map(([key, source]) => ({
      key,
      required: source.required !== false,
      error: source.error || "unknown error",
      consecutive_failures: source.consecutive_failures || 0,
    })),
    alert_sources: requiredFailed
      .filter(([, source]) => (source.consecutive_failures || 0) >= 3)
      .map(([key]) => key),
  };
}

function contentFingerprint(tools, models, events) {
  const stableSignal = (signal) => signal ? {
    title: signal.title,
    source_url: signal.source_url,
    feed_id: signal.feed_id || null,
    effective_at: signal.effective_at || null,
    confidence: signal.confidence || "verified",
  } : null;
  return {
    tools: tools.map((tool) => ({
      id: tool.id,
      latest_release: tool.latest_release,
      npm_version: tool.npm?.version || null,
    })),
    models: models.map((model) => ({
      id: model.id,
      latest_model: stableSignal(model.latest_model),
      latest_policy: stableSignal(model.latest_policy),
    })),
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      occurred_at: event.occurred_at,
      published_at: event.published_at || null,
      effective_at: event.effective_at || null,
      source_url: event.source_url,
      confidence: event.confidence,
    })),
  };
}

export async function main(now = new Date()) {
  const [sources, oldCurrent, oldEvents, oldSnapshots, oldStatus] = await Promise.all([
    readJson(sourceFile, { tools: [], models: [] }),
    readJson(path.join(publicData, "current.json"), {}),
    readJson(path.join(publicData, "events.json"), []),
    readJson(path.join(publicData, "snapshots.json"), []),
    readJson(path.join(publicData, "status.json"), { sources: {} }),
  ]);
  const cooldownMinutes = Number(process.env.COLLECTOR_COOLDOWN_MINUTES || 0);
  if (shouldSkipCollection(oldStatus, now, cooldownMinutes)) {
    console.log(`Skipped collection because the previous check is inside the ${cooldownMinutes}-minute cooldown.`);
    return { skipped: true, reason: "cooldown" };
  }

  const allowedKeys = configuredSourceKeys(sources);
  const sourceStatuses = Object.fromEntries(
    [...allowedKeys].map((key) => [key, oldStatus.sources?.[key] || {}]),
  );
  const oldTools = new Map((oldCurrent.tools || []).map((tool) => [tool.id, tool]));
  const oldModels = new Map((oldCurrent.models || []).map((model) => [model.id, model]));

  const toolResults = await Promise.all(sources.tools.map((source) => collectTool(source, oldTools.get(source.id), sourceStatuses, now)));
  const tools = toolResults.map((result) => result.tool);
  const modelResults = await Promise.all(sources.models.map((source) => collectModel(source, oldModels.get(source.id), sourceStatuses)));

  const snapshotsByTool = new Map(oldSnapshots.map((series) => [series.tool_id, series.points]));
  const slot = getFiveHourSlot(now);
  tools.forEach((tool) => {
    const points = snapshotsByTool.get(tool.id) || [];
    if (tool.stars !== null && !points.some((point) => point.captured_at === slot)) {
      points.push({ captured_at: slot, stars: tool.stars });
    }
    const pruned = pruneSnapshots(points, now);
    tool.stars_delta_24h = calculateDelta(pruned, tool.stars, 24 * 3600000, now);
    tool.stars_delta_7d = calculateDelta(pruned, tool.stars, 7 * 24 * 3600000, now);
    snapshotsByTool.set(tool.id, pruned);
  });

  const events = mergeEvents(oldEvents, [
    ...toolResults.flatMap((result) => result.events),
    ...modelResults.flatMap((result) => result.events),
  ]).filter((event) => event.type !== "deprecation" || isConcreteDeprecation(event.title));

  const models = modelResults.map((result) => result.model);
  const health = summarizeHealth(sourceStatuses);
  const checkedAt = now.toISOString();
  const contentHash = createHash("sha256")
    .update(JSON.stringify(contentFingerprint(tools, models, events)))
    .digest("hex");
  const contentUpdatedAt = oldStatus.content_hash === contentHash
    ? oldStatus.content_updated_at || oldCurrent.content_updated_at || oldCurrent.generated_at || checkedAt
    : checkedAt;
  const lastFullSuccessAt = health.counts.required_failed === 0
    ? checkedAt
    : oldStatus.last_full_success_at || oldStatus.latest_success_at || null;
  const snapshotId = `snapshot-${shortHash(`${checkedAt}:${contentHash}`)}`;
  const current = {
    schema_version: 1,
    snapshot_id: snapshotId,
    generated_at: checkedAt,
    checked_at: checkedAt,
    content_updated_at: contentUpdatedAt,
    last_full_success_at: lastFullSuccessAt,
    timezone: "Asia/Shanghai",
    status: health.overall,
    source_counts: health.counts,
    tools,
    models,
  };
  const status = {
    schema_version: 1,
    snapshot_id: snapshotId,
    checked_at: checkedAt,
    content_updated_at: contentUpdatedAt,
    last_full_success_at: lastFullSuccessAt,
    latest_success_at: lastFullSuccessAt,
    overall: health.overall,
    source_counts: health.counts,
    failed_sources: health.failed_sources,
    alert_sources: health.alert_sources,
    content_hash: contentHash,
    sources: sourceStatuses,
  };
  const bundle = {
    schema_version: 1,
    snapshot_id: snapshotId,
    checked_at: checkedAt,
    current,
    events,
    health: status,
  };

  await Promise.all([
    writeJson(path.join(publicData, "current.json"), current),
    writeJson(path.join(publicData, "events.json"), events),
    writeJson(path.join(publicData, "snapshots.json"), [...snapshotsByTool.entries()].map(([tool_id, points]) => ({ tool_id, points }))),
    writeJson(path.join(publicData, "status.json"), status),
    writeJson(path.join(publicData, "bundle.json"), bundle),
  ]);

  const feedCount = models.reduce((sum, model) => sum + (model.feeds?.length || 0), 0);
  console.log(`Collected ${tools.length} tools, ${models.length} models (${feedCount} feeds), ${events.length} events. Health: ${health.overall}. Snapshot: ${snapshotId}.`);
  return { skipped: false, current, events, status, bundle };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
