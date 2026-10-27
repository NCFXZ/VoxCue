import { spawn, spawnSync } from 'node:child_process';

// Test precondition only. No screenshot, account information, unlock attempt,
// system preference change or input injection. Unknown states fail closed.
export function requireUnlockedDesktop() {
  const result = spawnSync('/usr/sbin/ioreg', ['-n', 'Root', '-d', '1'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error || result.status !== 0) throw Error('Cannot verify Mac desktop availability');
  const states = [...result.stdout.matchAll(/"CGSSessionScreenIsLocked"\s*=\s*(Yes|No)/g)].map(
    (match) => match[1],
  );
  if (states.includes('Yes'))
    throw Error('Mac GUI tests require an unlocked desktop; screen is locked');
  if (!states.length) throw Error('Cannot verify Mac screen lock state; GUI checks remain pending');
}

export function holdDesktopAwake() {
  requireUnlockedDesktop();
  // Scoped power assertion, released with this test PID. This never unlocks a
  // session or changes the user's lock policy. Every GUI group rechecks the lock.
  const child = spawn('/usr/bin/caffeinate', ['-d', '-i', '-w', String(process.pid)], {
    stdio: 'ignore',
  });
  child.unref();
  const stop = () => child.kill('SIGTERM');
  process.once('exit', stop);
  return () => {
    process.removeListener('exit', stop);
    stop();
  };
}
