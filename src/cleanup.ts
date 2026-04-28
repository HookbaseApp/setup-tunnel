import * as core from '@actions/core';

function run(): void {
  const pidStr = core.getState('tunnel-pid');
  if (!pidStr) {
    return;
  }
  const pid = parseInt(pidStr, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    core.info(`Sent SIGTERM to hookbase tunnel (pid=${pid}).`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      // Process already gone — fine.
      return;
    }
    core.warning(
      `Failed to terminate hookbase tunnel (pid=${pid}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

run();
