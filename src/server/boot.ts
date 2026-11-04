import "server-only";
import { checkEnvAtBoot, EnvError, env } from "./env";
import { log } from "./log";

/**
 * Check the settings when the server starts. In production, a missing essential (the database,
 * or a public address for links) stops the server straight away with a message saying what to
 * set, rather than running and sending emails with broken links. Half-set providers are warned
 * about once, here.
 */
export function bootCheck() {
  try {
    checkEnvAtBoot(process.env, (msg) => log.warn(msg, { check: "env" }));
  } catch (e) {
    if (!(e instanceof EnvError)) throw e;
    for (const p of e.problems) log.error(p, { check: "env" });
    log.error("Gigsaw can't start until these settings are fixed (Railway: the service's Variables tab).", { check: "env" });
    process.exit(1);
  }
  const e = env();
  log.info("Gigsaw is starting", {
    nodeEnv: e.nodeEnv,
    appUrl: e.appUrl,
    email: !!e.email,
    sms: !!e.sms,
    scheduler: !e.disableScheduler,
    sentry: !!e.sentryDsn,
  });
}
