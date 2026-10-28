import { spawn, spawnSync } from 'node:child_process';

// Test precondition only. No screenshot, account information, unlock attempt,
// system preference change or input injection. Unknown states fail closed.
export function assertDesktopSession(output, uid = process.getuid()) {
  const lockValues = [...output.matchAll(/"CGSSessionScreenIsLocked"\s*=\s*([^,}]+)/g)].map(
    (match) => match[1].trim(),
  );
  if (lockValues.includes('Yes'))
    throw Error('Mac GUI tests require an unlocked desktop; screen is locked');
  if (lockValues.some((value) => value !== 'No'))
    throw Error('Cannot verify Mac screen lock state; GUI checks remain pending');
  const users = output.match(/"IOConsoleUsers"\s*=\s*(.*)/)?.[1] ?? '';
  const sessions = users.match(/\{[^{}]*\}/g) ?? [];
  const active = sessions.filter(
    (session) =>
      /"kCGSSessionOnConsoleKey"\s*=\s*Yes(?:,|})/.test(session) &&
      /"kCGSessionLoginDoneKey"\s*=\s*Yes(?:,|})/.test(session) &&
      Number(session.match(/"kCGSSessionUserIDKey"\s*=\s*(\d+)/)?.[1]) === uid,
  );
  // macOS omits ScreenIsLocked in an unlocked console session. Require the
  // current UID's positively active, fully logged-in console before accepting it.
  if (active.length !== 1)
    throw Error('Cannot verify an active logged-in Mac console; GUI checks remain pending');
}

export function requireUnlockedDesktop() {
  const result = spawnSync('/usr/sbin/ioreg', ['-n', 'Root', '-d', '1'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error || result.status !== 0) throw Error('Cannot verify Mac desktop availability');
  assertDesktopSession(result.stdout);
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
