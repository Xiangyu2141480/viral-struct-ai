import { spawnSync } from 'node:child_process';

const pythonCommand = findPythonCommand();
run(pythonCommand, ['-m', 'unittest', 'discover', '-s', 'tests', '-v']);
runPnpm(['--filter', '@viral-struct/api', 'test']);

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
