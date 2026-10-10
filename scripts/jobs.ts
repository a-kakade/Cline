export {};
const url = process.env.BETTER_AUTH_URL;
const secret = process.env.JOB_SECRET;
if (!url || !secret || secret.length < 32)
  throw new Error(
    "Configure BETTER_AUTH_URL and JOB_SECRET before running jobs.",
  );
async function run() {
  try {
    const response = await fetch(`${url}/api/internal/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(30000),
    });
    console.log(
      response.ok
        ? "Scheduled job completed."
        : `Scheduled job failed (${response.status}).`,
    );
    return response.ok;
  } catch {
    console.error(
      "Scheduled job unavailable. Check the app and job configuration.",
    );
    return false;
  }
}
if (process.argv.includes("--watch")) {
  console.log(
    "Local job runner active; this process must stay open. No production scheduling is configured.",
  );
  while (true) {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
} else if (!(await run())) process.exitCode = 1;
