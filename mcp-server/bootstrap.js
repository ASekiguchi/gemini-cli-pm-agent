/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bootstrap for the PM Agent MCP server.
 *
 * Gemini CLI installs Git-based extensions by cloning the repository, but it
 * does not guarantee that npm dependencies are installed before MCP discovery.
 * Keep this file dependency-free so it can install runtime dependencies before
 * handing stdio over to the real MCP server.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const thisDir = dirname(fileURLToPath(import.meta.url));
const extensionRoot = dirname(thisDir);
const serverPath = join(thisDir, 'server.js');

function hasRuntimeDependencies() {
  return (
    existsSync(
      join(
        extensionRoot,
        'node_modules',
        '@modelcontextprotocol',
        'sdk',
        'package.json',
      ),
    ) && existsSync(join(extensionRoot, 'node_modules', 'zod', 'package.json'))
  );
}

function installRuntimeDependencies() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(
    npmCommand,
    ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: extensionRoot,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.status !== 0) {
    process.stderr.write(
      'pm-agent: failed to install runtime dependencies. Run `npm ci --omit=dev` in the extension directory and retry.\n',
    );
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    process.exit(result.status ?? 1);
  }
}

if (!hasRuntimeDependencies()) {
  installRuntimeDependencies();
}

const child = spawn(process.execPath, [serverPath], {
  cwd: extensionRoot,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on('error', (error) => {
  process.stderr.write(`pm-agent: failed to start MCP server: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
