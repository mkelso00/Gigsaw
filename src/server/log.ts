import "server-only";
import { env, LOG_LEVELS, type LogLevel } from "./env";

// A tiny structured logger for server code. In production each entry is one line of JSON with
// level, msg, time and any context fields, so the logs can be searched and filtered by them
// (`message` repeats `msg` for log viewers, Railway's included, that show that field as the
// line's text). In development it prints a short readable line instead.
//
//   log.warn("Stripe didn't rename the product", { plan: key, err: e });
//
// Errors anywhere in the context are written out with their name, message, digest, code and
// stack. Never put secret values (keys, tokens, passwords) in the context.

export type LogContext = Record<string, unknown>;

/** An error as plain fields, following `cause` a few levels down. */
export function serialiseError(e: unknown, depth = 0): unknown {
  if (!(e instanceof Error)) return e;
  const x = e as Error & { digest?: unknown; code?: unknown; cause?: unknown };
  return {
    name: x.name,
    message: x.message,
    ...(x.digest !== undefined ? { digest: x.digest } : {}),
    ...(x.code !== undefined ? { code: x.code } : {}),
    ...(x.stack ? { stack: x.stack } : {}),
    ...(x.cause !== undefined && depth < 3 ? { cause: serialiseError(x.cause, depth + 1) } : {}),
  };
}

function plain(ctx: LogContext) {
  const out: LogContext = {};
  for (const [k, v] of Object.entries(ctx)) if (v !== undefined) out[k] = serialiseError(v);
  return out;
}

/** One log entry as a single JSON line. Exported for tests. */
export function formatJson(level: LogLevel, msg: string, ctx: LogContext = {}, now = new Date()) {
  const entry = { level, time: now.toISOString(), msg, message: msg, ...plain(ctx) };
  try {
    return JSON.stringify(entry);
  } catch {
    // Something in the context can't be written (a circular object): keep the message at least.
    return JSON.stringify({ level, time: entry.time, msg, message: msg, logError: "context could not be written" });
  }
}

const COLOURS: Record<LogLevel, string> = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };

function formatPretty(level: LogLevel, msg: string, ctx: LogContext) {
  const fields = plain(ctx);
  const errs: string[] = [];
  const rest = Object.entries(fields)
    .filter(([, v]) => {
      const isErr = v && typeof v === "object" && "stack" in v;
      if (isErr) errs.push(String((v as { stack: unknown }).stack));
      return !isErr;
    })
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  const time = new Date().toTimeString().slice(0, 8);
  return [`${COLOURS[level]}${time} ${level.toUpperCase().padEnd(5)}\x1b[0m ${msg}${rest ? ` \x1b[90m${rest}\x1b[0m` : ""}`, ...errs].join("\n");
}

function write(level: LogLevel, msg: string, ctx: LogContext = {}) {
  const e = env();
  if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(e.logLevel)) return;
  const line = e.nodeEnv === "development" ? formatPretty(level, msg, ctx) : formatJson(level, msg, ctx);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, ctx?: LogContext) => write("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => write("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => write("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => write("error", msg, ctx),
};
