/**
 * The package as a user gets it: `npm pack` (only what `files` lets through), the tarball unpacked, and that copy
 * installed with the vendored pi's own `pi install` into a fresh agent dir. pi then finds the extension through
 * package.json's `pi.extensions`, not through `-e src/index.ts`, so a wrong manifest or a file missing from the
 * package fails the smoke that uses it.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { PI_BIN, REPO, piEnv } from "./pi-rpc.ts";

/** Returns the installed package's directory (inside `root`). */
export function installPackedCopy(root: string, agentDir: string): string {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--pack-destination", root, "--json"], { cwd: REPO, encoding: "utf8" })) as { filename: string }[];
  const unpacked = path.join(root, "unpacked");
  fs.mkdirSync(unpacked);
  execFileSync("tar", ["-xzf", path.join(root, packed[0].filename), "-C", unpacked]);
  const packageDir = path.join(unpacked, "package");
  execFileSync(PI_BIN, ["install", packageDir], { cwd: root, env: piEnv(root, agentDir), stdio: ["ignore", "pipe", "pipe"] });
  const settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8")) as { packages?: unknown[] };
  if (!Array.isArray(settings.packages) || settings.packages.length !== 1) throw new Error(`pi install did not record the package: ${JSON.stringify(settings.packages)}`);
  return packageDir;
}
