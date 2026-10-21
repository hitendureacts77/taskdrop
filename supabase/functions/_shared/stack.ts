export type Frame = { function?: string; filename: string; lineno?: number; colno?: number; in_app: boolean };

/**
 * Turn a V8 stack ("    at fn (file:line:col)") into Sentry frames, oldest
 * call first as Sentry expects. Lines that do not look like frames are skipped.
 */
export function parseStack(stack: string | undefined): Frame[] {
  const frames: Frame[] = [];
  for (const line of (stack ?? "").split("\n")) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const filename = m[2].replace(/^async /, "");
    frames.push({
      function: m[1]?.replace(/^async /, ""),
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.startsWith("ext:") && !filename.startsWith("node:") && !filename.includes("/node_modules/"),
    });
  }
  return frames.reverse();
}
