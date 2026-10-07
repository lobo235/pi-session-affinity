/**
 * Checks what `npm pack` would publish: everything pi needs to load and run the extension, and nothing that only
 * the repository needs (tests, test support, scripts, CI, agent instructions). Exits 1 naming each problem.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const repo = path.join(import.meta.dirname, "..");
const REQUIRED = ["package.json", "README.md", "LICENSE", "CHANGELOG.md",
  "src/index.ts", "src/boundary.ts", "src/config.ts", "src/config-reader.ts", "src/headers.ts", "src/notice.ts", "src/provider-notices.ts"];
const FORBIDDEN = [/\.test\.ts$/, /(^|\/)test-support\.ts$/, /^scripts\//, /^\.github\//, /^AGENTS\.md$/, /^CLAUDE\.md$/, /\.env/, /^load-smoke\.mjs$/, /^tsconfig\.json$/];

const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: repo, encoding: "utf8", shell: process.platform === "win32" })) as
  { files: { path: string }[]; unpackedSize: number }[];
const files = packed[0].files.map((file) => file.path);

const problems = [
  ...REQUIRED.filter((name) => !files.includes(name)).map((name) => `missing: ${name}`),
  ...files.filter((name) => FORBIDDEN.some((pattern) => pattern.test(name))).map((name) => `must not ship: ${name}`),
];
for (const problem of problems) console.error(`check-pack: ${problem}`);
console.log(`check-pack: ${files.length} files, ${packed[0].unpackedSize} bytes unpacked: ${problems.length ? "FAIL" : "ok"}`);
process.exit(problems.length ? 1 : 0);
