import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
function walk(path) {
  return readdirSync(root + path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${path}${e.name}/`) : [`${path}${e.name}`],
  );
}
export function buildInfo() {
  const files = [
    ...walk("src/"),
    ...walk("public/"),
    ...walk("scripts/"),
    "package.json",
    "package-lock.json",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
  ].sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(root + file));
  }
  let revision = "local";
  try {
    revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* source archive */
  }
  return {
    version: JSON.parse(readFileSync(root + "package.json", "utf8")).version,
    revision,
    source: hash.digest("hex").slice(0, 16),
  };
}
if (process.argv.includes("--check")) {
  try {
    const actual = JSON.parse(readFileSync(root + "dist/version.json", "utf8"));
    const expected = buildInfo();
    if (Object.keys(expected).some((key) => expected[key] !== actual[key]))
      process.exitCode = 1;
  } catch {
    process.exitCode = 1;
  }
}
