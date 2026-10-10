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
 * npm, run through the npm that started this script when there is one (`npm_execpath`), so no shell is needed; a
 * direct run falls back to `npm` on the search path, through a shell on Windows, where it is a .cmd shim.
 */
function runNpm(args: string[], cwd: string): string {
  const npmCli = process.env.npm_execpath;
  if (npmCli && npmCli.endsWith(".js")) return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8" });
  return execFileSync("npm", args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
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
