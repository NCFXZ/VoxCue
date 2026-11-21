import { BrowserWindow, app, dialog, protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { handleDesktop } from './handle';
import { recordingRecordId } from '../contracts/recordings';
import { exportRecording, type RecordingLibrary, type LocalRecording } from '../backend/interview/recordings';
import { recordingResponse } from '../backend/interview/recordingStream';

let schemeRegistered = false;
export function registerRecordingScheme() {
  if (schemeRegistered) return;
  protocol.registerSchemesAsPrivileged([
    { scheme: 'voxcue-recording', privileges: { standard: true, secure: true, stream: true } },
  ]);
  schemeRegistered = true;
}

async function createExportDirectory(parent: string, name: string) {
  for (let index = 1; ; index++) {
    const directory = path.join(parent, index === 1 ? name : name + ' (' + index + ')');
    try {
      await mkdir(directory, { mode: 0o700 });
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export function registerRecordings(d: {
  requireMain(e: Electron.IpcMainInvokeEvent): void;
  requireInterview(e: Electron.IpcMainInvokeEvent): void;
  owner(): string | undefined;
  setRecording(prepare?: () => string): Promise<boolean>;
  text(key: string): string;
}, library: RecordingLibrary) {
  const grants = new Map<string, LocalRecording>();
  let reader: Electron.WebContents | undefined;
  let readerOwner: string | undefined;
  let readerRecord: string | undefined;
  let revision = 0;
  let writer: { sender: Electron.WebContents; owner: string; recordId: string } | undefined;

  const playbackSessions = new WeakSet<Electron.Session>();
  function enablePlayback(session: Electron.Session) {
    if (playbackSessions.has(session)) return;
    session.protocol.handle('voxcue-recording', (request) => {
      const clip = grants.get(request.url);
      if (!clip || !reader || reader.isDestroyed() || reader.session !== session ||
        !readerOwner || readerOwner !== d.owner()) return new Response(null, { status: 404 });
      return recordingResponse(request, clip);
    });
    playbackSessions.add(session);
  }
  handleDesktop('interview:recording', async (event, recordId, enabled, ...extra: unknown[]) => {
    d.requireInterview(event);
    const owner = d.owner();
    if (!owner || extra.length || !recordingRecordId(recordId) || typeof enabled !== 'boolean')
      throw Error('无效的录音操作。');
    if (!enabled) return d.setRecording();
    return d.setRecording(() => {
      d.requireInterview(event);
      if (d.owner() !== owner) throw Error('录音操作已取消。');
      const same =
        writer?.sender === event.sender && writer.owner === owner && writer.recordId === recordId;
      const directory = library.prepare(owner, recordId, same);
      writer = { sender: event.sender, owner, recordId };
      return directory;
    });
  });
  handleDesktop('history:pending-recording-removals', async (event, ...extra: unknown[]) => {
    d.requireMain(event);
    const owner = d.owner();
    if (extra.length || event.senderFrame !== event.sender.mainFrame) throw Error('无效的录音操作。');
    if (!owner) return [];
    const pending = await library.pendingRemovals(owner);
    d.requireMain(event);
    if (event.sender.isDestroyed() || d.owner() !== owner) throw Error('录音操作已取消。');
    return pending;
  });
  handleDesktop('history:recordings', async (event, call, ...extra: unknown[]) => {
    d.requireMain(event);
    const owner = d.owner();
    if (
      !owner ||
      event.senderFrame !== event.sender.mainFrame ||
      extra.length ||
      !call ||
      !recordingRecordId(call.recordId) ||
      !['list', 'remove', 'export', 'stage-remove', 'restore-remove', 'finish-remove'].includes(call.op) ||
      Object.keys(call).some(
        (k) =>
          !(
            call.op === 'export' ? ['op', 'recordId', 'ids', 'title'] : ['op', 'recordId']
          ).includes(k),
      )
    )
      throw Error('无效的录音操作。');
    const check = () => {
      d.requireMain(event);
      if (event.sender.isDestroyed() || d.owner() !== owner) throw Error('录音操作已取消。');
    };
    if (call.op === 'remove' || call.op === 'stage-remove' || call.op === 'restore-remove' || call.op === 'finish-remove') {
      if (
        writer?.recordId === call.recordId &&
        writer.owner === owner &&
        !writer.sender.isDestroyed()
      )
        throw Error('请先结束面试。');
      if (readerRecord === call.recordId && (call.op === 'remove' || call.op === 'finish-remove')) {
        ++revision;
        grants.clear();
      }
      if (call.op === 'stage-remove' || call.op === 'restore-remove')
        await library.moveRemoval(owner, call.recordId, call.op === 'restore-remove');
      else await library.remove(owner, call.recordId, call.op === 'finish-remove');
      check();
      return [];
    }
    if (call.op === 'list') {
      const generation = ++revision;
      grants.clear();
      reader = event.sender;
      readerOwner = owner;
      readerRecord = call.recordId;
      const clips = await library.inspect(owner, call.recordId);
      check();
      if (generation !== revision) return [];
      return clips.map((clip) => {
        if ('unavailable' in clip) return clip;
        const url = 'voxcue-recording://local/' + randomUUID();
        grants.set(url, clip);
        return { id: clip.id, startedAt: clip.startedAt, durationMs: clip.durationMs, url };
      });
    }
    if (
      call.op !== 'export' ||
      !Array.isArray(call.ids) ||
      !call.ids.length ||
      call.ids.length > 1000 ||
      !call.ids.every(recordingRecordId) ||
      new Set(call.ids).size !== call.ids.length ||
      typeof call.title !== 'string' ||
      call.title.length > 200
    )
      throw Error('无效的录音操作。');
    const clips = await library.inspect(owner, call.recordId);
    const selected = clips.filter((clip): clip is LocalRecording => 'file' in clip && call.ids.includes(clip.id));
    check();
    if (selected.length !== call.ids.length) throw Error('无法读取本地录音。');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw Error('录音操作已取消。');
    const title = call.title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 80);
    const name = 'VoxCue - ' + (title || d.text('面试记录'));
    try {
      if (selected.length === 1) {
        const result = await dialog.showSaveDialog(win, {
          title: d.text('导出录音'),
          defaultPath: path.join(app.getPath('downloads'), name + '.wav'),
          filters: [{ name: 'WAV', extensions: ['wav'] }],
        });
        check();
        if (!result.canceled && result.filePath) await exportRecording(selected[0], result.filePath);
      } else {
        const result = await dialog.showOpenDialog(win, {
          title: d.text('导出录音'),
          properties: ['openDirectory', 'createDirectory'],
        });
        check();
        if (result.canceled || !result.filePaths[0]) return [];
        const directory = await createExportDirectory(result.filePaths[0], name);
        const outputs: string[] = [];
        try {
          for (const clip of selected) {
            check();
            const file = path.join(
              directory,
              d.text('录音') + ' ' + (clips.indexOf(clip) + 1) + '.wav',
            );
            outputs.push(file);
            await exportRecording(clip, file);
          }
        } catch (error) {
          await Promise.allSettled(outputs.map((file) => unlink(file)));
          await rmdir(directory);
          throw error;
        }
      }
      return [];
    } catch {
      throw Error('导出失败，请重新选择保存位置。');
    }
  });
  return enablePlayback;
}
