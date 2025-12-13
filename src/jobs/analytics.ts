import { aggregateUserDaily, aggregateUserContactYearly, aggregateUserServerYearly, buildWrappedSnapshotsForYear } from "../analytics/aggregations.js";

console.debug("[PasusDebug:backend/src/jobs/analytics] Loaded");
const log = (...args: any[]) => console.log("[analytics-job]", ...args);

async function runDaily(day?: Date) {
  await aggregateUserDaily(day);
  log("daily aggregates complete", day?.toISOString() || "yesterday UTC");
}

async function runYearly(year: number) {
  await aggregateUserContactYearly(year);
  await aggregateUserServerYearly(year);
  log("yearly aggregates complete", year);
}

async function runWrapped(year: number) {
  await buildWrappedSnapshotsForYear(year);
  log("wrapped snapshots built", year);
}

export async function runScheduledAnalytics() {
  const enable = process.env.ANALYTICS_JOBS_ENABLED === "true";
  if (!enable) return;

  // Kick off once at startup (yesterday).
  runDaily().catch((err) => console.error("[analytics-job] daily failed", err));

  // Run daily every 24h.
  setInterval(() => {
    runDaily().catch((err) =>
      console.error("[analytics-job] daily failed", err)
    );
  }, 24 * 60 * 60 * 1000);

  // Refresh yearly aggregates and snapshots once per day at startup cadence.
  const year = new Date().getUTCFullYear();
  runYearly(year).catch((err) =>
    console.error("[analytics-job] yearly failed", err)
  );
  runWrapped(year).catch((err) =>
    console.error("[analytics-job] wrapped failed", err)
  );
}

// Simple CLI: `tsx src/jobs/analytics.ts daily` etc.
if (process.argv[1] && process.argv[1].endsWith("analytics.ts")) {
  const mode = process.argv[2] || "daily";
  const yearArg = Number(process.argv[3]) || new Date().getUTCFullYear();
  (async () => {
    switch (mode) {
      case "daily":
        await runDaily();
        break;
      case "yearly":
        await runYearly(yearArg);
        break;
      case "wrapped":
        await runWrapped(yearArg);
        break;
      case "all":
        await runDaily();
        await runYearly(yearArg);
        await runWrapped(yearArg);
        break;
      default:
        console.log("Usage: analytics.ts [daily|yearly|wrapped|all] [year]");
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
