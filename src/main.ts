import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { spawn } from 'child_process';
import { createInterface } from 'readline';

async function run(): Promise<void> {
  try {
    const port = core.getInput('port', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const subdomain = core.getInput('subdomain');
    const cliVersion = core.getInput('cli-version') || 'latest';
    const apiUrl = core.getInput('api-url');
    const readyTimeoutMs = parseInt(core.getInput('ready-timeout-ms') || '30000', 10);

    if (!/^\d+$/.test(port) || parseInt(port, 10) < 1 || parseInt(port, 10) > 65535) {
      throw new Error(`Invalid port: ${port}`);
    }
    if (!apiKey.startsWith('whr_')) {
      throw new Error('api-key must be a Hookbase API key starting with "whr_".');
    }

    core.info(`Installing @hookbase/cli@${cliVersion}...`);
    await exec.exec('npm', ['install', '-g', `@hookbase/cli@${cliVersion}`], {
      silent: true,
    });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOOKBASE_API_KEY: apiKey,
    };
    if (apiUrl) env.HOOKBASE_API_URL = apiUrl;

    const args = ['tunnels', 'start', port, '--json'];
    if (subdomain) args.push('--subdomain', subdomain);

    core.info(`Starting tunnel on port ${port}...`);
    const child = spawn('hookbase', args, {
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!child.pid) {
      throw new Error('Failed to spawn hookbase process.');
    }
    core.saveState('tunnel-pid', String(child.pid));

    const tunnelUrl = await waitForConnection(child, readyTimeoutMs);

    core.setOutput('tunnel-url', tunnelUrl);
    core.exportVariable('HOOKBASE_TUNNEL_URL', tunnelUrl);
    core.info(`Tunnel ready: ${tunnelUrl}`);

    detachFromChild(child);
    // Hard exit — the detached CLI keeps running; cleanup.ts SIGTERMs it
    // during the post step. Anything still holding our event loop open
    // (libuv references on the spawned child, internal stream buffers,
    // GITHUB_OUTPUT writes) would otherwise hang the action step.
    process.exit(0);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function detachFromChild(child: ReturnType<typeof spawn>): void {
  // Without this, the parent's event loop stays alive forever because we're
  // still piping stdout/stderr through readline / data listeners. We've got
  // what we need from the child — let it run on its own until cleanup.ts
  // SIGTERMs it during the post step.
  child.removeAllListeners('exit');
  child.removeAllListeners('error');
  child.stdout?.removeAllListeners();
  child.stderr?.removeAllListeners();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

function waitForConnection(
  child: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let createdUrl: string | null = null;
    let settled = false;

    const settleResolve = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(url);
    };
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    const timer = setTimeout(() => {
      settleReject(
        new Error(
          `Tunnel did not become ready within ${timeoutMs}ms. ` +
            (createdUrl ? `Tunnel was created (${createdUrl}) but never connected.` : '')
        )
      );
    }, timeoutMs);

    if (!child.stdout) {
      settleReject(new Error('hookbase process produced no stdout.'));
      return;
    }

    const stdoutLines = createInterface({ input: child.stdout });
    stdoutLines.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.event === 'tunnel.created' && typeof parsed.tunnelUrl === 'string') {
          createdUrl = parsed.tunnelUrl;
        }
        if (parsed.event === 'tunnel.connected' && typeof parsed.tunnelUrl === 'string') {
          settleResolve(parsed.tunnelUrl);
        }
      } catch {
        // ignore non-JSON lines
      }
    });

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        core.warning(`hookbase stderr: ${chunk.toString().trim()}`);
      });
    }

    child.on('exit', (code, signal) => {
      settleReject(
        new Error(
          `hookbase exited unexpectedly (code=${code}, signal=${signal}) before tunnel was ready.`
        )
      );
    });
    child.on('error', (err) => {
      settleReject(err);
    });
  });
}

run();
