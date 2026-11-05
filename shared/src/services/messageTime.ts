const calendarDay = (date: Date) => {
  const day = new Date(0);
  day.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return day.getTime() / 86_400_000;
};

export function formatMessageTime(
  timestamp: number | undefined,
  now = Date.now(),
  locale?: string,
): { text: string; dateTime: string } | null {
  if (timestamp === undefined) return null;
  const date = new Date(timestamp);
  const current = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) return null;
  // Compare local calendar dates, not elapsed 24-hour periods across DST.
  const days = calendarDay(current) - calendarDay(date);
  const text =
    days === 0
      ? new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(date)
      : days === 1
        ? '昨天'
        : days === 2
          ? '前天'
          : new Intl.DateTimeFormat(locale).format(date);
  return { text, dateTime: date.toISOString() };
}
