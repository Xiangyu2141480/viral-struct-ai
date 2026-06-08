import { spawnSync } from 'node:child_process';

const pythonCommand = findPythonCommand();
run(pythonCommand, ['-m', 'unittest', 'discover', '-s', 'tests', '-v']);
runPnpm(['--filter', '@viral-struct/api', 'test']);
runPnpm(['--filter', '@viral-struct/api', 'exec', 'node', '--import', 'tsx', '../web/app/_struct/api/assetManager.test.ts']);
// video-agent (③) has no tsx of its own; run its tests through the api package's tsx, mirroring the
// cross-package web test above. node:test auto-runs the registered tests when the file executes.
runPnpm(['--filter', '@viral-struct/api', 'exec', 'node', '--import', 'tsx', '--test', '../../packages/video-agent/src/authoring/authoring.test.ts']);

function findPythonCommand() {
  for (const command of ['python', 'python3']) {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore' });

    if (result.status === 0) {
      return command;
    }
  }

  console.error('Unable to find Python. Install python or python3 to run the Python test suite.');
  process.exit(1);
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function runPnpm(args) {
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', commandLineForCmd([pnpmCommand(), ...args])]);
    return;
  }

  run(pnpmCommand(), args);
}

function commandLineForCmd(parts) {
  return parts.map(String).join(' ');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
