import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatMessageTime } from '../../../shared/src/services/messageTime';

describe('message calendar timestamps', () => {
  const previousZone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/London';
  });
  afterAll(() => {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  });
  const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
    new Date(year, month - 1, day, hour, minute).getTime();

  it('uses two-digit 24-hour time today, including midnight, independently of a locale AM/PM default', () => {
    const now = at(2026, 11, 5, 23, 59);
    expect(formatMessageTime(at(2026, 11, 5, 0, 4), now, 'en-US')).toEqual({
      text: '00:04',
      dateTime: new Date(at(2026, 11, 5, 0, 4)).toISOString(),
    });
    expect(formatMessageTime(at(2026, 11, 5, 15, 7), now, 'en-US')?.text).toBe('15:07');
  });

  it('uses calendar labels across midnight, month/year boundaries and either DST shift', () => {
    expect(formatMessageTime(at(2025, 12, 31, 23, 59), at(2026, 1, 1, 0, 1))?.text).toBe('昨天');
    expect(formatMessageTime(at(2025, 12, 30, 23, 59), at(2026, 1, 1, 0, 1))?.text).toBe('前天');
    const spring = at(2026, 3, 29, 0, 45);
    const springNow = at(2026, 3, 30, 0, 30);
    expect(springNow - spring).toBeLessThan(24 * 60 * 60 * 1000);
    expect(formatMessageTime(spring, springNow)?.text).toBe('昨天');
    const autumn = at(2026, 10, 25, 0, 5);
    const autumnNow = at(2026, 10, 26, 0, 15);
    expect(autumnNow - autumn).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(formatMessageTime(autumn, autumnNow)?.text).toBe('昨天');
    expect(formatMessageTime(autumn, at(2026, 10, 25, 23, 45), 'en-GB')?.text).toBe('00:05');
  });

  it('keeps the system date style for older or future dates with an optional locale override', () => {
    const now = at(2026, 11, 5, 10);
    const older = at(2026, 11, 2, 15);
    expect(formatMessageTime(older, now)?.text).toBe(
      new Intl.DateTimeFormat(undefined).format(older),
    );
    expect(formatMessageTime(older, now, 'en-US')?.text).toBe('11/2/2026');
    expect(formatMessageTime(older, now, 'en-GB')?.text).toBe('02/11/2026');
    expect(formatMessageTime(at(2026, 11, 6), now, 'en-US')?.text).toBe('11/6/2026');
  });

  it('omits absent or invalid timestamps without inventing a current date', () => {
    for (const timestamp of [undefined, NaN, Infinity, -Infinity, 8_640_000_000_000_001])
      expect(formatMessageTime(timestamp)).toBeNull();
    expect(formatMessageTime(0, at(2026, 11, 5), 'en-GB')?.dateTime).toBe(
      '1970-01-01T00:00:00.000Z',
    );
    expect(formatMessageTime(at(2026, 11, 5), NaN)).toBeNull();
  });
});
