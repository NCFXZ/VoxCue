export async function readAnnouncements() {
  if (!window.desktop) throw Error('公告需要在 VoxCue 桌面应用中读取。');
  return window.desktop.announcements();
}
