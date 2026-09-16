import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function imports(source) {
  return Array.from(source.matchAll(/\bfrom\s+["']([^"']+)["']/g), (match) => match[1]);
}

async function collectModuleGraph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = await readFile(entry, "utf8");
  for (const specifier of imports(source)) {
    if (!specifier.startsWith(".")) continue;
    const dependency = fileURLToPath(new URL(specifier, pathToFileURL(entry)));
    await collectModuleGraph(dependency, seen);
  }
  return seen;
}

test("the documented repository-root entry resolves every browser module", async () => {
  const htmlPath = resolve(repositoryRoot, "app/index.html");
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css"/);
  assert.match(html, /<script type="module" src="\.\/src\/app\.js"><\/script>/);

  const graph = await collectModuleGraph(resolve(repositoryRoot, "app/src/app.js"));
  const paths = [...graph].map((path) => path.slice(repositoryRoot.length + 1));
  assert.deepEqual(paths.sort(), [
    "app/src/app.js",
    "app/src/evm.js",
    "app/src/geometry.js",
    "app/src/manifest.js",
    "app/src/reads.js",
    "app/src/replay-fixture.js",
    "app/src/scenarios.js",
    "app/src/workflows.js",
    "packages/simulator/src/replay.js"
  ]);
});
