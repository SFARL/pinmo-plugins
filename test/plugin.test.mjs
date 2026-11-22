import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

const PLUGIN_DIR = "plugins/pinmo";
const TOOLS = new Set(["list_memory_filters", "search_memories"]);

const skillFiles = () =>
  readdirSync(join(root, PLUGIN_DIR, "skills")).map((name) => join(root, PLUGIN_DIR, "skills", name, "SKILL.md"));

const frontmatter = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md starts with a frontmatter block");
  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.match(/^([a-z_-]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()]),
  );
};

test("marketplace entry and plugin manifest share the name pinmo", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const manifest = readJson(`${PLUGIN_DIR}/.claude-plugin/plugin.json`);
  assert.equal(marketplace.name, "pinmo");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "pinmo");
  assert.equal(marketplace.plugins[0].source, `./${PLUGIN_DIR}`);
  assert.equal(manifest.name, "pinmo");
});

test("the MCP server is the production Pinmo endpoint over http", () => {
  const { mcpServers } = readJson(`${PLUGIN_DIR}/.mcp.json`);
  assert.deepEqual(Object.keys(mcpServers), ["pinmo"]);
  assert.equal(mcpServers.pinmo.type, "http");
  assert.equal(mcpServers.pinmo.url, "https://pinmo.me/mcp");
});

test("skills only mention the two read-only tools", () => {
  const files = skillFiles();
  assert.ok(files.length >= 1);
  for (const file of files) {
    const mentioned = readFileSync(file, "utf8").match(/\b[a-z]+(?:_[a-z]+)*_(?:memories|filters)\b/g) ?? [];
    for (const name of mentioned) assert.ok(TOOLS.has(name), `${file}: unknown tool ${name}`);
  }
});

test("every skill has a description in its frontmatter", () => {
  for (const file of skillFiles()) {
    const { description } = frontmatter(readFileSync(file, "utf8"));
    assert.ok(description && description.length > 20, `${file}: description`);
  }
});
