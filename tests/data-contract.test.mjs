import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataRoot = new URL("../public/data/", import.meta.url);
const sourcesRoot = new URL("../data/", import.meta.url);

async function json(base, name) {
  return JSON.parse(await readFile(new URL(name, base), "utf8"));
}

test("published data interfaces remain available and parseable", async () => {
  const [current, events, snapshots, capabilities, status] = await Promise.all(
    ["current.json", "events.json", "snapshots.json", "capabilities.json", "status.json"].map((name) => json(dataRoot, name)),
  );
  assert.equal(current.timezone, "Asia/Shanghai");
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

test("events may include model policy and review metadata", async () => {
  const events = await json(dataRoot, "events.json");
  assert.ok(Array.isArray(events));
  const allowed = new Set(["release", "model", "deprecation", "source_changed"]);
  events.slice(0, 50).forEach((event) => {
    assert.ok(allowed.has(event.type), `unexpected event type ${event.type}`);
    assert.match(event.source_url, /^https:\/\//);
  });
});
