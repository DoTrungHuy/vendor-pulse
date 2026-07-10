import assert from "node:assert/strict";
import test from "node:test";
import { calculateDelta, getFiveHourSlot, mergeEvents, parseDatedModelEvent, parseRssModelEvent, pruneSnapshots } from "../scripts/collect.mjs";

test("five-hour slots remain contiguous across a UTC date boundary", () => {
  assert.equal(getFiveHourSlot(new Date("2026-07-10T23:59:59Z")), "2026-07-10T19:00:00.000Z");
  assert.equal(getFiveHourSlot(new Date("2026-07-11T00:00:01Z")), "2026-07-11T00:00:00.000Z");
  assert.equal(getFiveHourSlot(new Date("2026-07-11T01:00:00Z")), "2026-07-11T00:00:00.000Z");
});

test("event merging is idempotent and newest-first", () => {
  const result = mergeEvents([{ id: "one", occurred_at: "2026-07-01T00:00:00Z" }], [{ id: "one", occurred_at: "2026-07-02T00:00:00Z" }, { id: "two", occurred_at: "2026-07-03T00:00:00Z" }]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((event) => event.id), ["two", "one"]);
});

test("snapshot retention keeps high-resolution history for ninety days and daily rollups before it", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  const result = pruneSnapshots([{ captured_at: "2026-04-01T00:00:00Z", stars: 1 }, { captured_at: "2026-04-01T05:00:00Z", stars: 2 }, { captured_at: "2026-07-10T05:00:00Z", stars: 3 }], now);
  assert.deepEqual(result, [{ captured_at: "2026-04-01T05:00:00Z", stars: 2 }, { captured_at: "2026-07-10T05:00:00Z", stars: 3 }]);
});

test("star deltas only appear when an eligible comparison snapshot exists", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  const points = [{ captured_at: "2026-07-09T10:00:00Z", stars: 100 }, { captured_at: "2026-07-10T10:00:00Z", stars: 112 }];
  assert.equal(calculateDelta(points, 120, 24 * 3600000, now), 20);
  assert.equal(calculateDelta(points, 120, 7 * 24 * 3600000, now), null);
});

test("dated release-note parsing only accepts explicit release language", () => {
  const parsed = parseDatedModelEvent("<h2>June 30, 2026</h2><ul><li>Released gemini-test-preview for public preview.</li></ul>");
  assert.equal(parsed?.occurred_at, "2026-06-30T00:00:00.000Z");
  assert.match(parsed?.title || "", /Released/);
  assert.equal(parseDatedModelEvent("<h2>June 30, 2026</h2><p>Documentation wording clarified.</p>"), null);
});

test("RSS model parsing keeps a direct source URL for the latest model item", () => {
  const event = parseRssModelEvent("<rss><channel><item><title><![CDATA[GPT-5.6 is now available]]></title><link>https://openai.com/index/gpt-5-6/</link><pubDate>Thu, 09 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>");
  assert.equal(event?.title, "GPT-5.6 is now available");
  assert.equal(event?.source_url, "https://openai.com/index/gpt-5-6/");
});
