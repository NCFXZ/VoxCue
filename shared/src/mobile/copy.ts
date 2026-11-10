export type Language = 'zh' | 'en';

const english: Record<string, string> = {
  电脑端: 'Computer',
  更多: 'More',
  关闭: 'Close',
  设置: 'Settings',
  语言: 'Language',
  主题: 'Theme',
  跟随系统: 'System',
  浅色: 'Light',
  深色: 'Dark',
  字号: 'Text size',
  标准: 'Standard',
  大: 'Large',
  更大: 'Larger',
  转录: 'Transcript',
  隐藏: 'Hidden',
  预览: 'Preview',
  展开: 'Expand',
  收起: 'Collapse',
  显示转录: 'Show transcript',
  问题与回答: 'Questions and answers',
  回到最新: 'Back to latest',
  有新内容: 'New content',
  麦克风: 'Microphone',
  打开麦克风: 'Turn microphone on',
  关闭麦克风: 'Turn microphone off',
  自动回答: 'Auto answer',
  开: 'On',
  关: 'Off',
  '确认中…': 'Confirming…',
  '输入问题…': 'Enter a question…',
  发送: 'Send',
  '发送中…': 'Sending…',
  发送最新转录: 'Send latest transcript',
  最新待提问转录: 'Latest question from transcript',
  停止生成: 'Stop answer',
  '停止中…': 'Stopping…',
  '正在生成…': 'Generating…',
  已停止: 'Stopped',
  回答失败: 'Answer failed',
  '尚无问题与回答。': 'No questions or answers yet.',
  '转录会显示在上方，也可以输入问题。': 'View the transcript above or type a question.',
  '等待语音输入…': 'Waiting for speech…',
  对方: 'Other person',
  我: 'Me',
  '较早的内容请在电脑端查看。': 'View earlier content on your computer.',
  '本段内容已截短，完整内容请在电脑端查看。': 'This content is shortened. View the full version on your computer.',
  '正在转录…': 'Transcribing…',
  '输入同步失败，请重试。': 'Input sync failed. Please try again.',
  '输入已变化，请确认内容后重新发送。': 'The input has changed. Review it before sending again.',
  '电脑输入超过 6000 字符，请编辑后再发送。': 'The computer input exceeds 6,000 characters. Edit it before sending.',
  '离线时可阅读内容。恢复连接后，输入以电脑端为准。': 'You can read content offline. After reconnecting, the computer input takes precedence.',
  '面试已结束。内容仍可阅读。': 'The interview has ended. You can still read its content.',
  '等待电脑开始面试。': 'Waiting for an interview to start on your computer.',
  '电脑已暂停转录。': 'Transcription is paused on your computer.',
  '将设备连接到 VoxCue': 'Connect your device to VoxCue',
  '让设备与电脑连接同一 Wi-Fi。': 'Connect your device and computer to the same Wi-Fi.',
  '仅在可信的私人网络中使用。': 'Use a trusted private network.',
  连接电脑: 'Connect computer',
  重新连接: 'Reconnect',
  恢复连接: 'Resume connection',
  '正在建立连接…': 'Establishing connection…',
  等待电脑允许: 'Waiting for approval',
  '核对电脑与设备上的配对码，然后在电脑上允许连接。': 'Check that the codes match on both devices, then allow the connection on your computer.',
  配对码: 'Pairing code',
  '无法连接时，请回到电脑刷新二维码并重新扫码。': 'If you cannot connect, refresh the QR code on your computer and scan it again.',
  '连接网址只用于本次配对，刷新此页可能需要重新扫码。': 'The link is for this pairing attempt. Refreshing this page may require a new scan.',
  未连接: 'Not connected',
  已连接: 'Connected',
  已断开: 'Disconnected',
  连接失败: 'Connection failed',
  '连接中…': 'Connecting…',
  '重连中…': 'Reconnecting…',
  '同步中…': 'Syncing…',
  等待面试: 'Waiting for interview',
  断开连接: 'Disconnect',
  确认断开连接: 'Confirm disconnect',
  '断开后，电脑继续转录和回答。': 'Your computer will continue transcribing and answering after you disconnect.',
  '连接失败，请检查网络或重新扫码。': 'Could not connect. Check your network or scan a new QR code.',
  '请回到电脑刷新二维码并重新扫码。': 'Refresh the QR code on your computer and scan it again.',
  '二维码已过期，请重新扫码。': 'The QR code has expired. Scan a new code.',
  '已有其他设备正在配对或连接。': 'Another device is pairing or connected.',
  '电脑拒绝了连接，请重新扫码。': 'The connection was declined on your computer. Scan a new code.',
  '连接版本不一致，请更新 VoxCue 后重新扫码。': 'The connection versions do not match. Update VoxCue and scan again.',
  '连接授权已失效，请重新扫码。': 'Connection authorization has expired. Scan a new QR code.',
  '网络已断开，正在尝试恢复连接。': 'The network connection was lost. Trying to reconnect.',
  '连接超时，请检查网络。': 'The connection timed out. Check your network.',
  '电脑返回的内容无效，请重新连接。': 'The computer returned an invalid response. Reconnect.',
  '当前无法执行此操作，请等待电脑状态更新。': 'This action is unavailable. Wait for the computer state to update.',
  '请先输入问题或等待新的转录。': 'Enter a question or wait for a new transcript.',
  '问题过长，请缩短后发送。': 'The question is too long. Shorten it before sending.',
  '输入以电脑端为准，请稍后重试。': 'The computer input takes precedence. Try again shortly.',
  '操作失败，请重试。': 'The action failed. Please try again.',
  '操作结果尚未确认，恢复连接后会继续核对。': 'The action result is not confirmed yet. It will be checked after reconnecting.',
  '操作过于频繁，请稍候。': 'Too many actions. Wait a moment.',
  '面试已变化，请同步后重试。': 'The interview has changed. Wait for sync and try again.',
  '麦克风状态已变化，请同步后重试。': 'The microphone state has changed. Wait for sync and try again.',
  '当前无法切换麦克风，请稍后重试。': 'The microphone cannot be changed right now. Try again shortly.',
  '麦克风切换失败，请在电脑端检查。': 'Could not change the microphone. Check your computer.',
  '面试已变化，本次操作已取消。': 'The interview changed. This action was cancelled.',
  '麦克风状态未确认，请重试。': 'The microphone state was not confirmed. Try again.',
  '自动回答状态已变化，请同步后重试。': 'The automatic answer state has changed. Wait for sync and try again.',
  '当前无法切换自动回答。': 'Automatic answers cannot be changed right now.',
  '当前没有正在生成的回答。': 'No answer is currently being generated.',
  '当前回答已变化，请同步后重试。': 'The current answer has changed. Wait for sync and try again.',
  '请输入不超过 6000 字符的问题。': 'Enter a question of no more than 6,000 characters.',
  '当前无法发送问题，请等待回答完成后重试。': 'Wait for the current answer to finish before sending another question.',
  '当前转录问题已变化或已发送，请同步后重试。': 'The transcript question has changed or was already sent. Wait for sync and try again.',
  '问题未被接收，请同步后重试。': 'The question was not accepted. Wait for sync and try again.',
  '重复的操作标识无效。': 'The duplicate action ID is invalid.',
  '设备控制操作失败，请重试。': 'The device control action failed. Try again.',
  '上一操作尚未完成，请稍候。': 'The previous action is still in progress. Wait a moment.',
  '操作记录已满，请重新扫码连接。': 'The action history is full. Scan a new QR code to reconnect.',
  '操作编号冲突，请重新连接。': 'An action ID conflict occurred. Reconnect.',
  '图片': 'Image',
};

const errorCopy: Record<string, string> = {
  'pairing-required': '请回到电脑刷新二维码并重新扫码。',
  'invalid-address': '请回到电脑刷新二维码并重新扫码。',
  'invalid-link': '请回到电脑刷新二维码并重新扫码。',
  'pairing-expired': '二维码已过期，请重新扫码。',
  'pairing-conflict': '已有其他设备正在配对或连接。',
  'pairing-failed': '连接失败，请检查网络或重新扫码。',
  'pairing-rejected': '电脑拒绝了连接，请重新扫码。',
  'protocol-mismatch': '连接版本不一致，请更新 VoxCue 后重新扫码。',
  'authentication-failed': '连接授权已失效，请重新扫码。',
  'resume-expired': '连接授权已失效，请重新扫码。',
  'network-disconnected': '网络已断开，正在尝试恢复连接。',
  'connection-timeout': '连接超时，请检查网络。',
  'invalid-response': '电脑返回的内容无效，请重新连接。',
  'command-unavailable': '当前无法执行此操作，请等待电脑状态更新。',
  'question-empty': '请先输入问题或等待新的转录。',
  'question-too-long': '问题过长，请缩短后发送。',
  'draft-conflict': '输入以电脑端为准，请稍后重试。',
  'draft-sync-failed': '输入同步失败，请重试。',
  'command-failed': '操作失败，请重试。',
  'command-result-unknown': '操作结果尚未确认，恢复连接后会继续核对。',
  'request-limit': '操作过于频繁，请稍候。',
  'request-unknown': '操作结果尚未确认，恢复连接后会继续核对。',
  'request-conflict': '操作编号冲突，请重新连接。',
  'request-limit-repair-required': '操作记录已满，请重新扫码连接。',
  'command-busy': '上一操作尚未完成，请稍候。',
  'session-changed': '面试已变化，请同步后重试。',
};

export const mobileText = (source: string, language: Language) =>
  language === 'en' ? (english[source] ?? source) : source;

export function mobileError(code: string | null, message: string | null, language: Language) {
  if (message && Object.hasOwn(english, message)) return mobileText(message, language);
  if (message && errorCopy[message]) return mobileText(errorCopy[message], language);
  const source = code && errorCopy[code];
  if (source) return mobileText(source, language);
  if (message && (language === 'zh' || Object.hasOwn(english, message)))
    return mobileText(message, language);
  return mobileText('操作失败，请重试。', language);
}

export interface MobilePreferences {
  language: Language;
  theme: 'system' | 'light' | 'dark';
  font: 'normal' | 'large' | 'larger';
  transcript: 'preview' | 'expanded' | 'hidden';
}
const preferenceKey = 'voxcue.mobile.preferences.v1';
export function readMobilePreferences(): MobilePreferences {
  const defaults: MobilePreferences = {
    language: typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language) ? 'zh' : 'en',
    theme: 'system', font: 'normal', transcript: 'preview',
  };
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
    if (!value || typeof value !== 'object') return defaults;
    return {
      language: ['zh', 'en'].includes(value.language) ? value.language : defaults.language,
      theme: ['system', 'light', 'dark'].includes(value.theme) ? value.theme : defaults.theme,
      font: ['normal', 'large', 'larger'].includes(value.font) ? value.font : defaults.font,
      transcript: ['preview', 'expanded', 'hidden'].includes(value.transcript) ? value.transcript : defaults.transcript,
    };
  } catch { return defaults; }
}
export function saveMobilePreferences(value: MobilePreferences) {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify({
      language: value.language, theme: value.theme, font: value.font, transcript: value.transcript,
    }));
  } catch { /* The page remains usable when browser storage is unavailable. */ }
}
