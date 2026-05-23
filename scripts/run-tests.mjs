import { spawnSync } from 'node:child_process';

const pythonCommand = findPythonCommand();
run(pythonCommand, ['-m', 'unittest', 'discover', '-s', 'tests', '-v']);
run(pnpmCommand(), ['--filter', '@viral-struct/api', 'test']);

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

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
