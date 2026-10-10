/**
 * The package as a user gets it: `npm pack` (only what `files` lets through), the tarball unpacked, and that copy
 * installed with the vendored pi's own `pi install` into a fresh agent dir. pi then finds the extension through
 * package.json's `pi.extensions`, not through `-e src/index.ts`, so a wrong manifest or a file missing from the
 * package fails the smoke that uses it.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { REPO, runPi } from "./pi-rpc.ts";

/**
 * npm without a shell, which would re-parse arguments such as a temporary path: the npm-cli.js that started this
 * script (`npm_execpath`), else on Windows the one installed next to node, else `npm` on the search path.
 */
export function runNpm(args: string[], cwd: string): string {
  const started = process.env.npm_execpath;
  const besideNode = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const cli = started && /npm-cli\.c?js$/.test(started) ? started : process.platform === "win32" && fs.existsSync(besideNode) ? besideNode : undefined;
  return cli ? execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" }) : execFileSync("npm", args, { cwd, encoding: "utf8" });
}

/** Returns the installed package's directory (inside `root`). */
export function installPackedCopy(root: string, agentDir: string): string {
  const packed = JSON.parse(runNpm(["pack", "--pack-destination", root, "--json"], REPO)) as { filename: string }[];
  fs.mkdirSync(path.join(root, "unpacked"));
  // Relative operands, run from root: a tar that reads `C:` in an absolute Windows path as a remote host never sees one.
  execFileSync("tar", ["-xzf", packed[0].filename, "-C", "unpacked"], { cwd: root });
  const packageDir = path.join(root, "unpacked", "package");
  runPi(["install", packageDir], root, root, agentDir);
  const settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8")) as { packages?: unknown[] };
  if (!Array.isArray(settings.packages) || settings.packages.length !== 1) throw new Error(`pi install did not record the package: ${JSON.stringify(settings.packages)}`);
  return packageDir;
}
