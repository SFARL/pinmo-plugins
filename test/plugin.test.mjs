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

test("the Codex manifest matches the Claude manifest and points at the shared files", () => {
  const claude = readJson(`${PLUGIN_DIR}/.claude-plugin/plugin.json`);
  const codex = readJson(`${PLUGIN_DIR}/.codex-plugin/plugin.json`);
  assert.equal(codex.name, claude.name);
  assert.equal(codex.version, claude.version);
  assert.equal(codex.skills, "./skills/");
  assert.equal(codex.mcpServers, "./.mcp.json");
  for (const key of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    assert.ok(codex.interface[key], `interface.${key}`);
  }
});

test("the Codex marketplace lists the same plugin path as the Claude marketplace", () => {
  const claude = readJson(".claude-plugin/marketplace.json");
  const codex = readJson(".agents/plugins/marketplace.json");
  assert.equal(codex.name, claude.name);
  const [entry] = codex.plugins;
  assert.equal(entry.name, "pinmo");
  assert.deepEqual(entry.source, { source: "local", path: claude.plugins[0].source });
  assert.equal(entry.policy.installation, "AVAILABLE");
  assert.ok(entry.category);
});

// The pinmo CLI's commands and Pinmo's built-in place tags (lifemap `src/cli/main.ts`, `src/shared/place-tags.ts`).
const CLI_COMMANDS = new Set(["login", "import", "drafts", "suggest", "status", "logout", "help"]);
const PLACE_TAGS = new Set(
  `restaurant chinese_food hotpot bbq dumplings noodles japanese_food korean_food thai_food vietnamese_food indian_food
  italian_food pizza french_food mexican_food american_food burger steakhouse seafood middle_eastern_food vegetarian brunch
  fast_food food_court cafe tea bubble_tea bakery dessert ice_cream bar pub cocktail_bar wine_bar brewery nightclub tennis
  badminton table_tennis pickleball basketball soccer volleyball baseball swimming gym climbing yoga martial_arts dance golf
  skiing ice_skating skateboarding cycling running horse_riding surfing diving fishing bowling billiards stadium
  sports_center park garden beach hiking mountain lake waterfront viewpoint nature_reserve camping picnic playground
  hot_spring zoo aquarium theme_park museum gallery theater live_music cinema karaoke escape_room arcade board_games library
  bookstore landmark historic_site temple church place_of_worship mall supermarket convenience_store market clothing_store
  electronics_store home_goods florist pharmacy hotel hostel homestay airport train_station subway_station bus_station
  ferry school university coworking hospital dentist salon spa pet bank post_office government`.split(/\s+/),
);
const IMPORT_SKILL = `${PLUGIN_DIR}/skills/import-folder/SKILL.md`;

test("the plugin version is the same in the plugin manifest and the marketplace entry", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const manifest = readJson(`${PLUGIN_DIR}/.claude-plugin/plugin.json`);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(marketplace.plugins[0].version, manifest.version);
});

test("the import skill only runs pinmo commands the CLI has", () => {
  const text = readFileSync(join(root, IMPORT_SKILL), "utf8");
  const used = [...text.matchAll(/(?:^|`)pinmo ([a-z][a-z-]*)/gm)].map(([, command]) => command);
  assert.ok(used.includes("import") && used.includes("drafts") && used.includes("suggest"));
  for (const command of used) assert.ok(CLI_COMMANDS.has(command), `unknown pinmo command ${command}`);
});

test("the import skill only offers tags Pinmo accepts", () => {
  const text = readFileSync(join(root, IMPORT_SKILL), "utf8");
  const tagLine = text.split("\n").find((line) => line.includes("`--tag` values"));
  assert.ok(tagLine, "the skill lists the tags it may use");
  const tags = [...tagLine.matchAll(/`([a-z_]+)`/g)].map(([, tag]) => tag).filter((tag) => tag !== "tag");
  assert.ok(tags.length >= 5);
  for (const tag of tags) assert.ok(PLACE_TAGS.has(tag), `Pinmo rejects the tag ${tag}`);
});

test("the import skill never asks for photos to be uploaded without the CLI or for credentials to be shown", () => {
  const text = readFileSync(join(root, IMPORT_SKILL), "utf8");
  assert.match(text, /Do not try to upload the photos another way/);
  assert.match(text, /Never print, read aloud or copy the CLI's credentials file/);
});
