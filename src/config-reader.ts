/**
 * Reads the config file fresh for every use, so an edit applies without restarting pi, and reports a problem with
 * it once: again only when the problem changes, or comes back after the file was fixed.
 */
import { readConfigFile, type AffinityConfig, type ConfigResult } from "./config.ts";
import { notifyUser, type NoticeContext, type WriteStderr } from "./notice.ts";

export type ConfigReader = (ctx: NoticeContext) => AffinityConfig | undefined;

/** `configPath` may throw (it asks pi for the agent dir); that is reported like any other problem. */
export function createConfigReader(configPath: () => string, writeStderr: WriteStderr): ConfigReader {
  let reported: string | undefined;
  return (ctx) => {
    let result: ConfigResult;
    try {
      result = readConfigFile(configPath());
    } catch (error) {
      result = { problem: `cannot locate the config file (${error instanceof Error ? error.message : String(error)})` };
    }
    if ("config" in result) {
      reported = undefined;
      return result.config;
    }
    if (result.problem !== reported) {
      reported = result.problem;
      notifyUser(ctx, `session-affinity: ${result.problem}. Nothing is sent and no boundary request is made until it is fixed.`, "error", writeStderr);
    }
    return undefined;
  };
}
