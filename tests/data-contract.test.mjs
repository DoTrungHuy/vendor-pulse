import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataRoot = new URL("../public/data/", import.meta.url);
async function json(name) { return JSON.parse(await readFile(new URL(name, dataRoot), "utf8")); }

test("published data interfaces remain available and parseable", async () => {
  const [current, events, snapshots, capabilities, status] = await Promise.all(["current.json", "events.json", "snapshots.json", "capabilities.json", "status.json"].map(json));
  assert.equal(current.timezone, "Asia/Shanghai");
  assert.ok(Array.isArray(current.tools));
  assert.ok(Array.isArray(events));
  assert.ok(Array.isArray(snapshots));
  assert.ok(Array.isArray(capabilities));
  assert.equal(typeof status.sources, "object");
});

test("capability radar data has five bounded source-backed axes per tool", async () => {
  const capabilities = await json("capabilities.json");
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
