import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDelta,
  canonicalEventKey,
  classifyEventType,
  getFiveHourSlot,
  isConcreteDeprecation,
  mergeEvents,
  normalizeFeeds,
  parseAnthropicNews,
  parseDatedModelEvent,
  parseDatedModelEvents,
  parseDeprecationsPage,
  parseRssModelEvent,
  parseRssModelEvents,
  pruneSnapshots,
  shouldSkipCollection,
  summarizeHealth,
} from "../scripts/collect.mjs";

test("five-hour slots remain contiguous across a UTC date boundary", () => {
  assert.equal(getFiveHourSlot(new Date("2026-07-10T23:59:59Z")), "2026-07-10T19:00:00.000Z");
  assert.equal(getFiveHourSlot(new Date("2026-07-11T00:00:01Z")), "2026-07-11T00:00:00.000Z");
  assert.equal(getFiveHourSlot(new Date("2026-07-11T01:00:00Z")), "2026-07-11T00:00:00.000Z");
});

test("event merging is idempotent and newest-first", () => {
  const base = {
    item_id: "gpt",
    item_name: "GPT",
    type: "model",
    source_url: "https://example.com/news",
    provider: "OpenAI",
    feed_id: "news",
    confidence: "verified",
  };
  const result = mergeEvents(
    [{ ...base, id: "legacy-one", title: "GPT-5.6 released", occurred_at: "2026-07-01T00:00:00Z" }],
    [
      { ...base, id: "new-one", title: "GPT-5.6 released", occurred_at: "2026-07-01T00:00:00Z" },
      { ...base, id: "two", title: "GPT-5.7 released", occurred_at: "2026-07-03T00:00:00Z" },
    ],
  );
  assert.equal(result.length, 2);
  assert.match(result[0].title, /5\.7/);
  assert.ok(result.every((event) => event.id === event.canonical_key));
});

test("pending page fragments keep one stable identity across repeated scans", () => {
  const fragment = {
    item_id: "claude",
    item_name: "Claude",
    type: "deprecation",
    title: "Claude Sonnet preview may be retired; migration details need review",
    source_url: "https://example.com/deprecations",
    provider: "Anthropic",
    feed_id: "deprecations",
    confidence: "needs_review",
  };
  const first = { ...fragment, id: "old", occurred_at: "2026-07-01T00:00:00Z" };
  const later = { ...fragment, id: "new", occurred_at: "2026-07-03T00:00:00Z" };
  const result = mergeEvents([first], [later]);
  assert.equal(result.length, 1);
  assert.equal(result[0].occurred_at, "2026-07-01T00:00:00Z");
  assert.equal(result[0].last_seen_at, "2026-07-03T00:00:00Z");
  assert.equal(canonicalEventKey(first), canonicalEventKey(later));
});

test("lifecycle variants share one canonical identity", () => {
  const base = {
    item_id: "claude",
    type: "deprecation",
    feed_id: "deprecations",
    confidence: "verified",
    effective_at: "2026-06-30T00:00:00.000Z",
  };
  const concise = { ...base, title: "Claude: Claude Mythos Preview will be retired on June 30, 2026." };
  const tableVariant = { ...base, title: "Claude: Model status Claude Mythos Preview will be retired on June 30, 2026. Migration guide" };
  assert.equal(canonicalEventKey(concise), canonicalEventKey(tableVariant));
});

test("snapshot retention keeps high-resolution history for ninety days and daily rollups before it", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  const result = pruneSnapshots(
    [
      { captured_at: "2026-04-01T00:00:00Z", stars: 1 },
      { captured_at: "2026-04-01T05:00:00Z", stars: 2 },
      { captured_at: "2026-07-10T05:00:00Z", stars: 3 },
    ],
    now,
  );
  assert.deepEqual(result, [
    { captured_at: "2026-04-01T05:00:00Z", stars: 2 },
    { captured_at: "2026-07-10T05:00:00Z", stars: 3 },
  ]);
});

test("star deltas only appear when an eligible comparison snapshot exists", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  const points = [
    { captured_at: "2026-07-09T10:00:00Z", stars: 100 },
    { captured_at: "2026-07-10T10:00:00Z", stars: 112 },
  ];
  assert.equal(calculateDelta(points, 120, 24 * 3600000, now), 20);
  assert.equal(calculateDelta(points, 120, 7 * 24 * 3600000, now), null);
});

test("dated release-note parsing only accepts explicit release language", () => {
  const parsed = parseDatedModelEvent("<h2>June 30, 2026</h2><ul><li>Released gemini-test-preview for public preview.</li></ul>");
  assert.equal(parsed?.occurred_at, "2026-06-30T00:00:00.000Z");
  assert.match(parsed?.title || "", /Released/);
  assert.equal(parseDatedModelEvent("<h2>June 30, 2026</h2><p>Documentation wording clarified.</p>"), null);
});

test("dated sections can return multiple model signals", () => {
  const events = parseDatedModelEvents(`
July 9, 2026
Released GPT-5.6 Sol for frontier capability.

June 30, 2026
Released gemini-omni-flash-preview.
`);
  assert.equal(events.length, 2);
  assert.match(events[0].title, /GPT-5\.6|gemini/i);
});

test("RSS model parsing keeps a direct source URL for the latest model item", () => {
  const event = parseRssModelEvent("<rss><channel><item><title><![CDATA[GPT-5.6 is now available]]></title><link>https://openai.com/index/gpt-5-6/</link><pubDate>Thu, 09 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>");
  assert.equal(event?.title, "GPT-5.6 is now available");
  assert.equal(event?.source_url, "https://openai.com/index/gpt-5-6/");
});

test("RSS parsing accepts deprecation and retirement headlines", () => {
  const events = parseRssModelEvents(`
  <rss><channel>
    <item><title>Retiring OpenAI o3 and GPT-4.5</title><link>https://openai.com/index/retire/</link><pubDate>Thu, 28 May 2026 10:00:00 GMT</pubDate></item>
    <item><title>Company picnic photos</title><link>https://openai.com/index/picnic/</link><pubDate>Thu, 01 May 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "deprecation");
});

test("deprecations page parser extracts concrete model shutdown language", () => {
  const events = parseDeprecationsPage(`
  Upcoming deprecations
  On June 11, 2026, we notified developers that gpt-5-2025-08-07 will be shut down on December 11, 2026.
  Recommended replacement: gpt-5.5
  `);
  assert.ok(events.length >= 1);
  assert.equal(events[0].type, "deprecation");
  assert.match(events[0].title, /shut down|gpt-5/i);
  assert.equal(events[0].effective_at, "2026-12-11T00:00:00.000Z");
  assert.equal(events[0].published_at, null);
});

test("deprecations page parser ignores glossary and page chrome", () => {
  assert.equal(isConcreteDeprecation("See which Claude models are active, deprecated, or retired, and find retirement dates"), false);
  assert.equal(isConcreteDeprecation("Current and recently retired models are listed in the following table with their status: API model name Current state Deprecated"), false);
  assert.equal(isConcreteDeprecation("Active: The model is fully supported and recommended for use. Legacy: The model will"), false);
  assert.equal(isConcreteDeprecation("On December 11, 2026 gpt-5-2025-08-07 will be shut down"), true);
});

test("anthropic news parser finds dated Claude launches", () => {
  const events = parseAnthropicNews(`
  Introducing Claude Opus 4.7
  April 16, 2026
  Other marketing copy
  `);
  assert.ok(events.length >= 1);
  assert.match(events[0].title, /Claude Opus 4\.7/i);
});

test("normalizeFeeds supports multi-feed and legacy single-source configs", () => {
  const multi = normalizeFeeds({
    source_url: "https://example.com",
    feeds: [{ id: "a", url: "https://example.com/a", kind: "deprecation", parser: "deprecations-page", priority: 1 }],
  });
  assert.equal(multi[0].kind, "deprecation");
  const legacy = normalizeFeeds({ source_url: "https://example.com", parser: "rss-model", fetch_url: "https://example.com/rss.xml" });
  assert.equal(legacy[0].parser, "rss-model");
  assert.equal(legacy[0].url, "https://example.com/rss.xml");
});

test("classifyEventType prefers policy keywords", () => {
  assert.equal(classifyEventType("GPT-5.6 is now available"), "model");
  assert.equal(classifyEventType("Retiring GPT-4.5", "model"), "deprecation");
  assert.equal(classifyEventType("Routine note", "deprecation"), "deprecation");
});

test("collection cooldown supplies a staggered schedule without duplicate writes", () => {
  const now = new Date("2026-07-12T12:00:00Z");
  assert.equal(shouldSkipCollection({ checked_at: "2026-07-12T11:30:00Z" }, now, 45), true);
  assert.equal(shouldSkipCollection({ checked_at: "2026-07-12T11:00:00Z" }, now, 45), false);
  assert.equal(shouldSkipCollection({ checked_at: "2026-07-12T11:30:00Z" }, now, 0), false);
});

test("health distinguishes optional degradation from required-source failure", () => {
  const optionalFailure = summarizeHealth({
    required: { status: "ok", required: true, consecutive_failures: 0 },
    optional: { status: "error", required: false, error: "403", consecutive_failures: 3 },
  });
  assert.equal(optionalFailure.overall, "degraded");
  assert.equal(optionalFailure.counts.required_failed, 0);
  assert.deepEqual(optionalFailure.alert_sources, []);

  const requiredFailure = summarizeHealth({
    healthy: { status: "ok", required: true, consecutive_failures: 0 },
    failed: { status: "error", required: true, error: "timeout", consecutive_failures: 3 },
  });
  assert.equal(requiredFailure.overall, "degraded");
  assert.equal(requiredFailure.counts.required_failed, 1);
  assert.deepEqual(requiredFailure.alert_sources, ["failed"]);
});

test("health becomes an error only when every required source is unavailable", () => {
  const result = summarizeHealth({
    one: { status: "error", required: true, consecutive_failures: 1 },
    two: { status: "error", required: true, consecutive_failures: 1 },
    optional: { status: "ok", required: false, consecutive_failures: 0 },
  });
  assert.equal(result.overall, "error");
  assert.equal(result.counts.required_healthy, 0);
});
