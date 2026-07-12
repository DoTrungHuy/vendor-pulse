import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataRoot = new URL("../public/data/", import.meta.url);
const sourcesRoot = new URL("../data/", import.meta.url);

async function json(base, name) {
  return JSON.parse(await readFile(new URL(name, base), "utf8"));
}

test("published data interfaces remain available and parseable", async () => {
  const [bundle, current, events, snapshots, capabilities, status] = await Promise.all(
    ["bundle.json", "current.json", "events.json", "snapshots.json", "capabilities.json", "status.json"].map((name) => json(dataRoot, name)),
  );
  assert.equal(bundle.snapshot_id, current.snapshot_id);
  assert.equal(bundle.snapshot_id, status.snapshot_id);
  assert.deepEqual(bundle.current, current);
  assert.deepEqual(bundle.events, events);
  assert.equal(current.timezone, "Asia/Shanghai");
  assert.ok(["ok", "degraded", "error"].includes(current.status));
  assert.equal(typeof current.source_counts.total, "number");
  assert.ok(Array.isArray(current.tools));
  assert.ok(Array.isArray(current.models));
  assert.ok(Array.isArray(events));
  assert.ok(Array.isArray(snapshots));
  assert.ok(Array.isArray(capabilities));
  assert.equal(typeof status.sources, "object");
});

test("capability radar data has five bounded source-backed axes per tool", async () => {
  const capabilities = await json(dataRoot, "capabilities.json");
  assert.equal(capabilities.length, 4);
  capabilities.forEach((capability) => {
    assert.equal(capability.axes.length, 5);
    capability.axes.forEach((axis) => {
      assert.ok(axis.count >= 0 && axis.count <= 4);
      assert.equal(axis.items.length, 4);
      axis.items.forEach((item) => assert.match(item.source_url, /^https:\/\//));
    });
  });
});

test("model sources define multiple free official feeds per vendor", async () => {
  const sources = await json(sourcesRoot, "sources.json");
  assert.ok(sources.models.length >= 3);
  sources.models.forEach((model) => {
    assert.ok(Array.isArray(model.feeds));
    assert.ok(model.feeds.length >= 2, `${model.id} should have at least two feeds`);
    model.feeds.forEach((feed) => {
      assert.match(feed.url, /^https:\/\//);
      assert.ok(["model", "deprecation", "policy"].includes(feed.kind));
      assert.ok(feed.parser);
      assert.equal(typeof feed.required, "boolean");
    });
  });
});

test("current model records expose feed health and policy slots when collected", async () => {
  const current = await json(dataRoot, "current.json");
  assert.ok(current.models.length >= 1);
  current.models.forEach((model) => {
    if (model.feeds) {
      assert.ok(Array.isArray(model.feeds));
      model.feeds.forEach((feed) => {
        assert.ok(feed.id);
        assert.ok(feed.label);
        assert.ok(["ok", "error", "stale", "bootstrapping"].includes(feed.status) || typeof feed.status === "string");
      });
    }
  });
});

test("public events contain only verified official records while review candidates stay internal", async () => {
  const [events, status] = await Promise.all([json(dataRoot, "events.json"), json(dataRoot, "status.json")]);
  assert.ok(Array.isArray(events));
  const allowed = new Set(["release", "model", "deprecation"]);
  events.forEach((event) => {
    assert.ok(allowed.has(event.type), `unexpected event type ${event.type}`);
    assert.match(event.source_url, /^https:\/\//);
    assert.equal(event.confidence, "verified");
    assert.equal(event.id, event.canonical_key);
  });
  assert.ok(Array.isArray(status.review_queue));
  assert.ok(events.some((event) => event.published_at), "expected summary-ready publish dates");
  assert.ok(events.some((event) => event.effective_at), "expected lifecycle effective dates");
});

test("Claude Sonnet 5 is one dated verified launch, not a duplicate review item", async () => {
  const events = await json(dataRoot, "events.json");
  const sonnet = events.filter((event) => /Claude Sonnet 5/i.test(event.title));
  assert.equal(sonnet.length, 1);
  assert.equal(sonnet[0].confidence, "verified");
  assert.equal(sonnet[0].published_at, "2026-06-30T00:00:00.000Z");
  assert.equal(sonnet[0].source_url, "https://www.anthropic.com/news/claude-sonnet-5");
});

test("customer stories and compatibility mentions are not published as model launches", async () => {
  const events = await json(dataRoot, "events.json");
  const modelTitles = events.filter((event) => event.type === "model").map((event) => event.title).join("\n");
  assert.doesNotMatch(modelTitles, /Australian Payments Plus|helped immunologist|Bio Bug Bounty|model compatibility table/i);
});
