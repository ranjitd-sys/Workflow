const commands = [
  Bun.spawn(['npm', 'run', 'dev:front'], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
  Bun.spawn(['npm', 'run', 'dev:server'], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
  Bun.spawn(['npm', 'run', 'dev:workflow'], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
];

let stopping = false;

function stop(): void {
  if (stopping) return;
  stopping = true;
  for (const command of commands) command.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const codes = await Promise.all(commands.map((command) => command.exited));
stop();

process.exit(codes.some((code) => code !== 0 && code !== 130 && code !== 143) ? 1 : 0);
