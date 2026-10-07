/**
 * How a message reaches the user: pi's notification when the session has a UI (the TUI, RPC), standard error
 * otherwise (print and JSON modes, where pi's notify is a no-op and the message would be lost).
 */

export type NoticeLevel = "info" | "warning" | "error";

/** The slice of pi's event context a notice needs. */
export interface NoticeContext {
  hasUI: boolean;
  ui: { notify(message: string, type?: NoticeLevel): void };
}

export type WriteStderr = (text: string) => void;

export const writeProcessStderr: WriteStderr = (text) => void process.stderr.write(text);

/** Shows `text` to the user. Never throws: a notice must not fail the request or event it is raised from. */
export function notifyUser(ctx: NoticeContext, text: string, level: NoticeLevel, writeStderr: WriteStderr): void {
  try {
    if (ctx.hasUI) ctx.ui.notify(text, level);
    else writeStderr(`${text}\n`);
  } catch {
    // Nowhere left to report to; the extension's own behaviour (send nothing) already holds.
  }
}
