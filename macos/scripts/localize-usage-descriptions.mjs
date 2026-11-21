import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// System permission prompts follow macOS's language, independently of the UI preference.
export const englishUsageDescriptions = {
  NSMicrophoneUsageDescription:
    'VoxCue transcribes microphone audio locally when you start voice input or an interview. Audio is saved on this Mac only when interview recording is enabled and is never uploaded.',
  NSAudioCaptureUsageDescription:
    'VoxCue transcribes system audio locally when you start an interview. Audio is saved on this Mac only when interview recording is enabled and is never uploaded.',
  NSScreenCaptureUsageDescription:
    'VoxCue captures the current screen only when you click Screenshot. The image is held temporarily and used for an answer only after you click Send. VoxCue does not continuously record your screen.',
};

export async function localizeUsageDescriptions(app) {
  const plist = path.join(app, 'Contents/Info.plist');
  const original = JSON.parse(
    execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }),
  );
  const chinese = {};
  for (const key of Object.keys(englishUsageDescriptions)) {
    if (typeof original[key] !== 'string' || !original[key])
      throw Error('Missing permission description: ' + key);
    chinese[key] = original[key];
  }
  // Preserve each host's existing Chinese descriptions byte for byte.
  for (const [locale, descriptions] of [
    ['en', englishUsageDescriptions],
    ['zh-Hans', chinese],
    ['zh_CN', chinese],
  ]) {
    const directory = path.join(app, 'Contents/Resources', locale + '.lproj');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'InfoPlist.strings'),
      Object.entries(descriptions)
        .map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)};`)
        .join('\n') + '\n',
    );
  }
  execFileSync('/usr/bin/plutil', [
    '-replace',
    'CFBundleDevelopmentRegion',
    '-string',
    'en',
    plist,
  ]);
}
