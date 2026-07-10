import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicData = path.join(root, "public", "data");
const sourceFile = path.join(root, "data", "sources.json");
const fiveHours = 5 * 60 * 60 * 1000;
const userAgent = "agent-pulse-collector/1.0";

export function getFiveHourSlot(date = new Date()) {
  return new Date(Math.floor(date.getTime() / fiveHours) * fiveHours).toISOString();
}

export function mergeEvents(existing, additions) {
  const byId = new Map(existing.map((event) => [event.id, event]));
  additions.forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
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

export function parseDatedModelEvent(content) {
  const text = stripMarkup(content);
  const sections = [...text.matchAll(/(?:^|\n)([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s*\n+([\s\S]*?)(?=\n[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*\n|$)/g)];
  for (const section of sections) {
    const date = new Date(`${section[1]} UTC`);
    const sentence = section[2].split(/(?<=[.!?。])\s+/).map((entry) => entry.replace(/^[-•\s]+/, "").trim()).find((entry) => /(released|launch|introduc|available|deprecated|shut down|发布|上线|弃用)/i.test(entry));
    if (Number.isFinite(date.getTime()) && sentence) return { occurred_at: date.toISOString(), title: sentence.slice(0, 220) };
  }
  return null;
}

export function parseRssModelEvent(content) {
  const decode = (value) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
  const items = [...content.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  for (const item of items) {
    const body = item[1];
    const title = decode(body.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const published = body.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
    const url = decode(body.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
    if (/\bGPT[-\s]|\bgpt-oss\b|Introducing Codex|Codex is now generally available/i.test(title) && published && Number.isFinite(new Date(published).getTime())) {
      return { occurred_at: new Date(published).toISOString(), title, source_url: url || null };
    }
  }
  return null;
}

function stripMarkup(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(h[1-6]|li|p|section|article|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function request(url, previous = {}) {
  const isGitHub = url.includes("api.github.com");
  const headers = { "user-agent": userAgent, accept: isGitHub ? "application/vnd.github+json" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
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

function sourceState(previous, response, error) {
  return {
    status: error ? "error" : "ok",
    checked_at: new Date().toISOString(),
    etag: response?.headers?.get("etag") || previous?.etag || null,
    last_modified: response?.headers?.get("last-modified") || previous?.last_modified || null,
    content_hash: response?.body ? createHash("sha256").update(response.body).digest("hex") : previous?.content_hash || null,
    previous_hash: previous?.content_hash || null,
    error: error ? String(error.message || error) : null,
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function cadence(releases, now) {
  const recent = releases.filter((release) => new Date(release.published_at).getTime() >= now.getTime() - 30 * 86400000);
  const intervals = recent.slice(0, -1).map((release, index) => Math.abs(new Date(release.published_at) - new Date(recent[index + 1].published_at)) / 86400000);
  return { count: recent.length, median_days: median(intervals) };
}

async function collectTool(source, oldTool, sourceStatuses, now) {
  const repoKey = `github:${source.id}:repo`;
  const releaseKey = `github:${source.id}:releases`;
  const npmKey = source.npm ? `npm:${source.id}` : null;
  let repo = null, releases = [], npm = oldTool?.npm || null;
  const errors = [];
  try {
    const result = await request(`https://api.github.com/repos/${source.repo}`, sourceStatuses[repoKey]);
    sourceStatuses[repoKey] = sourceState(sourceStatuses[repoKey], result);
    repo = result.unchanged ? oldTool : JSON.parse(result.body);
  } catch (error) { sourceStatuses[repoKey] = sourceState(sourceStatuses[repoKey], null, error); errors.push(error); }
  try {
    const result = await request(`https://api.github.com/repos/${source.repo}/releases?per_page=20`, sourceStatuses[releaseKey]);
    sourceStatuses[releaseKey] = sourceState(sourceStatuses[releaseKey], result);
    releases = result.unchanged ? [] : JSON.parse(result.body);
  } catch (error) { sourceStatuses[releaseKey] = sourceState(sourceStatuses[releaseKey], null, error); errors.push(error); }
  if (source.npm) {
    try {
      const [packageResult, downloadsResult] = await Promise.all([
        request(`https://registry.npmjs.org/${encodeURIComponent(source.npm)}/latest`, sourceStatuses[npmKey]),
        request(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(source.npm)}`),
      ]);
      sourceStatuses[npmKey] = sourceState(sourceStatuses[npmKey], packageResult);
      npm = packageResult.unchanged ? oldTool?.npm : { package: source.npm, version: JSON.parse(packageResult.body).version, weekly_downloads: JSON.parse(downloadsResult.body).downloads ?? null };
    } catch (error) { sourceStatuses[npmKey] = sourceState(sourceStatuses[npmKey], null, error); errors.push(error); }
  }
  const latest = releases[0] || null;
  const stars = repo?.stargazers_count ?? oldTool?.stars ?? null;
  return {
    tool: {
      id: source.id, name: source.name, repo: source.repo, repo_url: `https://github.com/${source.repo}`, official_url: source.official_url, x_url: source.x_url,
      stars, stars_delta_24h: null, stars_delta_7d: null,
      latest_release: latest ? { tag: latest.tag_name, title: latest.name || latest.tag_name, published_at: latest.published_at, url: latest.html_url } : oldTool?.latest_release || null,
      release_cadence_30d: releases.length ? cadence(releases, now) : oldTool?.release_cadence_30d || { count: 0, median_days: null },
      npm, status: errors.length >= 2 ? "error" : errors.length ? "stale" : "ok",
    },
    events: releases.map((release) => ({ id: `release:${source.id}:${release.id}`, item_id: source.id, item_name: source.name, type: "release", title: `${source.name} ${release.name || release.tag_name}`, occurred_at: release.published_at, source_url: release.html_url })),
  };
}

async function collectModel(source, oldModel, sourceStatuses) {
  const key = `model:${source.id}`;
  try {
    const previousSource = sourceStatuses[key];
    const result = await request(source.fetch_url || source.source_url, previousSource);
    sourceStatuses[key] = sourceState(previousSource, result);
    if (result.unchanged) return { model: { ...oldModel, status: "ok" }, event: null };
    const parsed = source.parser === "dated-headings" ? parseDatedModelEvent(result.body) : source.parser === "rss-model" ? parseRssModelEvent(result.body) : null;
    sourceStatuses[key].content_hash = createHash("sha256").update(stripMarkup(result.body)).digest("hex");
    sourceStatuses[key].previous_hash = previousSource?.content_hash || null;
    sourceStatuses[key].normalized = true;
    const model = { id: source.id, name: source.name, provider: source.provider, source_url: source.source_url, title: parsed?.title || oldModel?.title || "官方发布说明页已建立基线", occurred_at: parsed?.occurred_at || oldModel?.occurred_at || null, status: "ok" };
    const changed = Boolean(oldModel && previousSource?.normalized && sourceStatuses[key].content_hash !== sourceStatuses[key].previous_hash);
    const event = parsed && parsed.title !== oldModel?.title ? { id: `model:${source.id}:${parsed.occurred_at}:${createHash("sha1").update(parsed.title).digest("hex").slice(0, 10)}`, item_id: source.id, item_name: source.name, type: "model", title: `${source.name}: ${parsed.title}`, occurred_at: parsed.occurred_at, source_url: parsed.source_url || source.source_url } : changed ? { id: `source:${source.id}:${sourceStatuses[key].content_hash.slice(0, 12)}`, item_id: source.id, item_name: source.name, type: "source_changed", title: `${source.name} 官方发布说明页内容变化，待核验`, occurred_at: new Date().toISOString(), source_url: source.source_url } : null;
    return { model, event };
  } catch (error) {
    sourceStatuses[key] = sourceState(sourceStatuses[key], null, error);
    return { model: { ...(oldModel || { id: source.id, name: source.name, provider: source.provider, source_url: source.source_url, title: null, occurred_at: null }), status: "error" }, event: null };
  }
}

export async function main(now = new Date()) {
  const [sources, oldCurrent, oldEvents, oldSnapshots, oldStatus] = await Promise.all([
    readJson(sourceFile, { tools: [], models: [] }), readJson(path.join(publicData, "current.json"), {}), readJson(path.join(publicData, "events.json"), []), readJson(path.join(publicData, "snapshots.json"), []), readJson(path.join(publicData, "status.json"), { sources: {} }),
  ]);
  const sourceStatuses = oldStatus.sources || {};
  const oldTools = new Map((oldCurrent.tools || []).map((tool) => [tool.id, tool]));
  const oldModels = new Map((oldCurrent.models || []).map((model) => [model.id, model]));
  const toolResults = await Promise.all(sources.tools.map((source) => collectTool(source, oldTools.get(source.id), sourceStatuses, now)));
  const tools = toolResults.map((result) => result.tool);
  const modelResults = await Promise.all(sources.models.map((source) => collectModel(source, oldModels.get(source.id), sourceStatuses)));
  const snapshotsByTool = new Map(oldSnapshots.map((series) => [series.tool_id, series.points]));
  const slot = getFiveHourSlot(now);
  tools.forEach((tool) => {
    const points = snapshotsByTool.get(tool.id) || [];
    if (tool.stars !== null && !points.some((point) => point.captured_at === slot)) points.push({ captured_at: slot, stars: tool.stars });
    const pruned = pruneSnapshots(points, now);
    tool.stars_delta_24h = calculateDelta(pruned, tool.stars, 24 * 3600000, now);
    tool.stars_delta_7d = calculateDelta(pruned, tool.stars, 7 * 24 * 3600000, now);
    snapshotsByTool.set(tool.id, pruned);
  });
  const events = mergeEvents(oldEvents, [...toolResults.flatMap((result) => result.events), ...modelResults.map((result) => result.event).filter(Boolean)]);
  const allSourcesHealthy = tools.every((tool) => tool.status === "ok") && modelResults.every((result) => result.model.status === "ok");
  const current = { generated_at: now.toISOString(), timezone: "Asia/Shanghai", status: allSourcesHealthy ? "ok" : "stale", tools, models: modelResults.map((result) => result.model) };
  const status = { latest_success_at: now.toISOString(), sources: sourceStatuses };
  await Promise.all([
    writeJson(path.join(publicData, "current.json"), current), writeJson(path.join(publicData, "events.json"), events), writeJson(path.join(publicData, "snapshots.json"), [...snapshotsByTool.entries()].map(([tool_id, points]) => ({ tool_id, points }))), writeJson(path.join(publicData, "status.json"), status),
  ]);
  console.log(`Collected ${tools.length} tools, ${modelResults.length} model sources, ${events.length} events.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
