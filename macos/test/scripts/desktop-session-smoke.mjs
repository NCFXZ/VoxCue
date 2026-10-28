import assert from 'node:assert/strict';
import { assertDesktopSession, requireUnlockedDesktop } from './desktop-session.mjs';

const session = (suffix = '') =>
  '"IOConsoleUsers" = ({"kCGSSessionOnConsoleKey"=Yes,' +
  '"kCGSessionLoginDoneKey"=Yes,"kCGSSessionUserIDKey"=501' +
  suffix +
  '})';
assertDesktopSession(session(), 501);
assertDesktopSession(session(',"CGSSessionScreenIsLocked"=No'), 501);
for (const output of [
  session(',"CGSSessionScreenIsLocked"=Yes'),
  session(',"CGSSessionScreenIsLocked"=unknown'),
  session().replace('=501', '=502'),
  session().replace('OnConsoleKey"=Yes', 'OnConsoleKey"=No'),
  session().replace('LoginDoneKey"=Yes', 'LoginDoneKey"=No'),
  '',
  session() + session(),
])
  assert.throws(() => assertDesktopSession(output, 501));
requireUnlockedDesktop();
console.log('PASS: nine lock/console fixtures and actual current unlocked console.');
