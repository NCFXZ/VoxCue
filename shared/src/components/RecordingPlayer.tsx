import { InterviewReveal } from './InterviewReveal';
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { playableRecording, type PlayableRecording, type RecordingSegment } from '../../electron/contracts/recordings';
import { t } from '../i18n';
import { Button } from './ui/button';
import * as Menu from './ui/dropdown-menu';
import { Modal } from './ui/modal';
import { RangeSlider } from './ui/range-slider';
import { BackTen, Check, ChevronRight, Download, Expand, ForwardTen, Locate, Minimize, Pause, Play, X } from './icons';
import { RecordingWaveIcon } from './RecordingWaveIcon';
import './recordingPlayer.css';

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
function segmentLabel(clip: RecordingSegment, index: number, origin: number) {
  if (!playableRecording(clip)) return t('录音 {0}　无法读取', [index + 1]);
  return t('录音{0}（{1}–{2}）', [
    index + 1,
    clock(clip.startedAt - origin),
    clock(clip.startedAt + clip.durationMs - origin),
  ]);
}

export function RecordingExport({
  clips,
  recordId,
  title,
  origin,
  onError,
}: {
  clips: RecordingSegment[];
  recordId: string;
  title: string;
  origin: number;
  onError(error: string): void;
}) {
  const [selected, select] = useState<string[] | null>(null);
  const [listExpanded, setListExpanded] = useState(true);
  const listId = useId();
  const [busy, setBusy] = useState(false);
  const available = clips.filter(playableRecording);
  const [dialogError, setDialogError] = useState('');
  async function save(ids: string[]) {
    setBusy(true);
    onError('');
    setDialogError('');
    try {
      await window.desktop!.recordings({ op: 'export', recordId, title, ids });
      select(null);
    } catch {
      if (selected) setDialogError('导出失败，请重新选择保存位置。');
      else onError('导出失败，请重新选择保存位置。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={busy || !available.length}
        onClick={() => {
          if (clips.length === 1) void save([clips[0].id]);
          else {
            setDialogError('');
            setListExpanded(true);
            select(available.map((clip) => clip.id));
          }
        }}
      >
        <Download size={16} />
        {t('导出录音')}
      </Button>
      {selected && (
        <Modal
          title={t('导出录音')}
          className="record-export-dialog"
          onClose={() => {
            if (!busy) select(null);
          }}
          footer={
            <div className="interview-start-actions">
              <Button variant="outline" disabled={busy} onClick={() => select(null)}>
                <X size={16} />{t('取消')}
              </Button>
              <Button disabled={busy || !selected.length} onClick={() => void save(selected)}>
                <Download size={16} />{t('导出录音')}
              </Button>
            </div>
          }
        >
          <div className="record-export-group-heading selection-group-heading">
            <label className="selection-option">
              <input
                type="checkbox"
                disabled={busy}
                checked={selected.length === available.length}
                ref={(node) => {
                  if (node) {
                    node.indeterminate = selected.length > 0 && selected.length < available.length;
                  }
                }}
                onChange={(event) =>
                  select(event.currentTarget.checked ? available.map((clip) => clip.id) : [])
                }
              />
              <span id={listId + '-label'}>{available.length === clips.length
                ? t('所有录音') : t('所有可用录音（{0} 段）', [available.length])}</span>
            </label>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="record-export-toggle selection-toggle"
              aria-label={listExpanded ? t('收起录音列表') : t('展开录音列表')}
              aria-expanded={listExpanded}
              aria-controls={listId}
              disabled={busy}
              onClick={() => setListExpanded((open) => !open)}
            >
              <ChevronRight size={15} />
            </Button>
          </div>
          <div
            id={listId}
            role="group"
            className="record-export-list"
            aria-labelledby={listId + '-label'}
            aria-hidden={!listExpanded}
            inert={!listExpanded}
          >
            <div className="record-export-segments">
              {clips.map((clip, index) => (
                <label className="selection-option" key={clip.id} data-unavailable={!playableRecording(clip) || undefined}>
                  <input
                    type="checkbox"
                    disabled={busy || !playableRecording(clip)}
                    checked={selected.includes(clip.id)}
                    onChange={(event) =>
                      select(
                        event.currentTarget.checked
                          ? [...selected, clip.id]
                          : selected.filter((id) => id !== clip.id),
                      )
                    }
                  />
                  <span>{segmentLabel(clip, index, origin)}</span>
                </label>
              ))}
            </div>
          </div>
          <InterviewReveal resizeKey={dialogError ?? ''}>
            {dialogError ? (
              <p role="alert" className="danger-text">
                {t(dialogError)}
              </p>
            ) : null}
          </InterviewReveal>
        </Modal>
      )}
    </>
  );
}

export interface RecordingPlayerHandle {
  playFrom(clip: PlayableRecording, time: number): void;
}

export type RecordingScrubPhase = 'press' | 'drag' | 'release' | 'seek';

interface PointerScrub {
  seconds: number;
  play: boolean;
  moved: boolean;
  phase?: 'drag' | 'seek';
  listeners: AbortController;
}

export function RecordingPlayer({
  ref,
  clips: segments,
  origin,
  following,
  onPosition,
  onScrub,
  onLocate,
  onError,
}: {
  clips: RecordingSegment[];
  origin: number;
  ref: Ref<RecordingPlayerHandle>;
  following: boolean;
  onPosition(time: number | null, follow?: boolean): void;
  onScrub(clip: PlayableRecording, time: number, phase: RecordingScrubPhase): void;
  onLocate(clip: PlayableRecording, time: number): void;
  onError(message: string): void;
}) {
  const clips = useMemo(() => segments.filter(playableRecording), [segments]);
  const [index, setIndex] = useState(0);
  const clip = clips[index] ?? clips[0];
  const audio = useRef<HTMLAudioElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const [expanded, expand] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const pending = useRef<{ id: string; seconds: number; play: boolean } | null>(null);
  const drag = useRef<PointerScrub | null>(null);
  const playRequest = useRef(0);
  const duration = clip.durationMs / 1000;
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    if (element.getAttribute('src') !== clip.url) element.src = clip.url;
    return () => {
      drag.current?.listeners.abort();
      drag.current = null;
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [clip.id, clip.url]);
  const update = useCallback((element: HTMLAudioElement | null) => {
    if (!element || element !== audio.current || drag.current || pending.current || element.seeking) return;
    setPosition(element.currentTime);
    onPosition(clip.startedAt + element.currentTime * 1000);
  }, [clip, onPosition]);
  useEffect(() => {
    if (!playing) return;
    const element = audio.current;
    const timer = window.setInterval(() => update(element), 65);
    return () => clearInterval(timer);
  }, [playing, update]);
  const play = () => {
    const element = audio.current;
    const request = ++playRequest.current;
    if (element)
      void element.play().catch((error: Error) => {
        if (request === playRequest.current && audio.current === element && error.name !== 'AbortError') {
          setPlaying(false);
          onError('无法播放本地录音。');
        }
      });
  };
  function seekAudio(target: PlayableRecording, offset: number, shouldPlay: boolean) {
    const element = audio.current;
    if (target.id !== clip.id || !element?.readyState) {
      pending.current = { id: target.id, seconds: offset, play: shouldPlay };
      setPlaying(shouldPlay);
      if (target.id !== clip.id) {
        element?.pause();
        setIndex(clips.indexOf(target));
      }
    } else {
      pending.current = null;
      if (!shouldPlay && !element.paused) element.pause();
      element.currentTime = offset;
      if (shouldPlay && element.paused) play();
    }
  }
  function moveTo(target: PlayableRecording, seconds: number, shouldPlay: boolean, follow: boolean) {
    drag.current?.listeners.abort();
    drag.current = null;
    const offset = Math.max(0, Math.min(seconds, target.durationMs / 1000));
    seekAudio(target, offset, shouldPlay);
    setPosition(offset);
    onPosition(target.startedAt + offset * 1000, follow);
  }
  const playbackRequested = () => drag.current?.play ?? pending.current?.play ?? audio.current?.paused === false;
  const seek = (seconds: number) => moveTo(clip, seconds, playbackRequested(), true);
  function finishClip(seconds: number) {
    const next = clips[index + 1];
    if (next) moveTo(next, 0, true, false);
    else {
      setPlaying(false);
      setPosition(seconds);
      onPosition(null);
    }
  }
  function commitScrub(seconds: number, shouldPlay: boolean) {
    const element = audio.current;
    if (!element || element.error) return;
    const end = Number.isFinite(element.duration) ? Math.min(duration, element.duration) : duration;
    if (shouldPlay && seconds >= end) {
      // play() on a paused element at its end restarts that clip.
      seekAudio(clip, seconds, false);
      finishClip(seconds);
    } else seekAudio(clip, seconds, shouldPlay);
  }
  const sliderStep = Math.min(0.01, duration);
  function sliderOffset(value: number) {
    // A native range snaps End to its last valid step, even for an unaligned recording duration.
    const lastStep = Math.floor(clip.durationMs / 10) / 100;
    return value > 0 && value >= lastStep ? duration : value;
  }
  function scrub(value: number) {
    const seconds = sliderOffset(value);
    const gesture = drag.current;
    const phase = gesture?.moved ? 'drag' : 'seek';
    if (gesture) {
      if (gesture.phase === phase && gesture.seconds === seconds) return;
      gesture.seconds = seconds;
      gesture.phase = phase;
    }
    setPosition(seconds);
    onScrub(clip, clip.startedAt + seconds * 1000, phase);
    if (!gesture) commitScrub(seconds, playbackRequested());
  }
  function beginScrub(event: ReactPointerEvent<HTMLDivElement>) {
    const input = event.target;
    const element = audio.current;
    if (!(input instanceof HTMLInputElement) || !element || !event.isPrimary || event.button !== 0 || drag.current) return;
    const listeners = new AbortController();
    const gesture: PointerScrub = {
      seconds: sliderOffset(input.valueAsNumber),
      play: playbackRequested(),
      moved: false,
      listeners,
    };
    drag.current = gesture;
    ++playRequest.current;
    element.pause();
    onScrub(clip, clip.startedAt + gesture.seconds * 1000, 'press');

    // A track click dispatches input even if the pointer never moves. A press on
    // the thumb may not dispatch input at all, so read the native value after its default action.
    let frame = 0;
    const scheduleRead = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (drag.current === gesture && gesture.phase !== (gesture.moved ? 'drag' : 'seek')) {
          scrub(input.valueAsNumber);
        }
      });
    };
    scheduleRead();
    listeners.signal.addEventListener('abort', () => cancelAnimationFrame(frame), { once: true });
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const detectMovement = (move: PointerEvent) => {
      if (move.pointerId !== pointerId || gesture.moved || move.clientX === startX) return;
      gesture.moved = true;
      scheduleRead();
    };
    const finish = (cancelled: boolean) => {
      if (drag.current !== gesture) return;
      const current = audio.current === element;
      if (current && !cancelled) scrub(input.valueAsNumber);
      listeners.abort();
      drag.current = null;
      if (!current) return;
      if (gesture.moved || cancelled) onScrub(clip, clip.startedAt + gesture.seconds * 1000, 'release');
      commitScrub(gesture.seconds, gesture.play);
    };
    const finishPointer = (end: PointerEvent) => {
      if (end.pointerId !== pointerId) return;
      if (end.type === 'pointerup') detectMovement(end);
      finish(end.type !== 'pointerup');
    };
    const blur = () => finish(true);
    const options = { signal: listeners.signal };
    window.addEventListener('pointermove', detectMovement, { ...options, capture: true });
    window.addEventListener('pointerup', finishPointer, options);
    window.addEventListener('pointercancel', finishPointer, options);
    input.addEventListener('lostpointercapture', finishPointer, options);
    input.addEventListener('blur', blur, options);
    window.addEventListener('blur', blur, options);
  }
  useImperativeHandle(ref, () => ({
    playFrom(target, time) {
      moveTo(target, (time - target.startedAt) / 1000, true, target.id !== clip.id);
    },
  }));
  const choices = clips.length > 1 && (
    <Menu.Root open={menu} onOpenChange={setMenu}>
      <Menu.Trigger asChild>
        <Button size="icon" variant="ghost" aria-label={t('选择录音')}>
          <RecordingWaveIcon />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="dropdown-content compact-tool-menu record-clip-menu"
          side="top"
          align="end"
          sideOffset={8}
        >
          <Menu.RadioGroup
            value={clip.id}
            onValueChange={(id) => {
              const next = clips.findIndex((item) => item.id === id);
              if (next < 0 || next === index) return;
              moveTo(clips[next], 0, playbackRequested(), true);
            }}
          >
            {segments.map((item, i) => playableRecording(item) && (
              <Menu.RadioItem key={item.id} value={item.id} className="dropdown-item model-option">
                {segmentLabel(item, i, origin)}
                <Menu.ItemIndicator className="dropdown-check">
                  <Check size={14} />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
  const button = (
    <Button
      ref={playButton}
      size="icon"
      variant="ghost"
      aria-label={playing ? t('暂停播放') : t('播放录音')}
      onClick={() => {
        if (pending.current) {
          pending.current.play = !pending.current.play;
          setPlaying(pending.current.play);
        } else if (audio.current?.paused) play();
        else audio.current?.pause();
      }}
    >
      {playing ? <Pause size={19} /> : <Play size={19} />}
    </Button>
  );
  const open = expanded || menu || (!collapsed && (hovered || focused));
  return (
    <div
      className="record-player"
      data-expanded={expanded}
      data-open={open}
      data-multiple={clips.length > 1}
      onPointerEnter={() => {
        setHovered(true);
        setCollapsed(false);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => {
        const keyboardFocus = event.target.matches(':focus-visible');
        setFocused(keyboardFocus);
        if (keyboardFocus) setCollapsed(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (collapsed && event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          setCollapsed(false);
          requestAnimationFrame(
            () =>
              event.target instanceof HTMLElement &&
              event.target
                .closest('.record-player')
                ?.querySelector<HTMLButtonElement>('.record-player-options button')
                ?.focus(),
          );
        }
      }}
    >
      <audio
        key={clip.id}
        ref={audio}
        src={clip.url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const jump = pending.current;
          if (!drag.current && jump?.id === clip.id && event.currentTarget === audio.current) {
            pending.current = null;
            event.currentTarget.currentTime = jump.seconds;
            if (jump.play) play();
          }
        }}
        onPlay={(event) => {
          if (event.currentTarget !== audio.current || event.currentTarget.paused || drag.current || pending.current) return;
          setPlaying(true);
          update(event.currentTarget);
          onError('');
        }}
        onPause={(event) => {
          // Natural completion also emits pause, immediately before ended.
          if (audio.current === event.currentTarget && event.currentTarget.paused &&
              !drag.current && !pending.current && !event.currentTarget.ended) {
            setPlaying(false);
            update(event.currentTarget);
          }
        }}
        onEnded={(event) => {
          const element = event.currentTarget;
          if (element !== audio.current || drag.current || pending.current || !element.ended || !playing) return;
          finishClip(element.currentTime);
        }}
        onError={(event) => {
          if (event.currentTarget === audio.current && event.currentTarget.hasAttribute('src') &&
              (!pending.current || pending.current.id === clip.id)) {
            ++playRequest.current;
            pending.current = null;
            setPlaying(false);
            if (drag.current) drag.current.play = false;
            else onPosition(null);
            onError('无法播放本地录音。');
          }
        }}
      />
      <div className="record-player-seek record-extra" inert={!expanded} onPointerDownCapture={beginScrub}>
        <time>{clock(position * 1000)}</time>
        <RangeSlider name={t('录音进度')} valueText={clock(position * 1000)}
          minimum={0} maximum={duration} step={sliderStep} value={position} onChange={scrub} />
        <time>−{clock((duration - position) * 1000)}</time>
      </div>
      <div className="record-player-controls">
        <Button variant="ghost" size="icon" className="record-player-locate record-extra"
          aria-label={t('定位到当前位置')} disabled={!expanded || following}
          onClick={() => {
            const offset = pending.current?.id === clip.id
              ? pending.current.seconds : audio.current?.currentTime ?? position;
            playButton.current?.focus({ preventScroll: true });
            onLocate(clip, clip.startedAt + offset * 1000);
          }}>
          <Locate size={18} />
        </Button>
        <div className="record-player-transport">
          <Button variant="ghost" size="icon" className="record-player-back record-extra"
            disabled={!expanded} aria-label={t('后退十秒')} onClick={() => seek(position - 10)}>
            <BackTen size={20} />
          </Button>
          {button}
          <Button variant="ghost" size="icon" className="record-player-forward record-extra"
            disabled={!expanded} aria-label={t('前进十秒')} onClick={() => seek(position + 10)}>
            <ForwardTen size={20} />
          </Button>
        </div>
        <div className="record-player-options" inert={!open}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={expanded ? t('收起播放器') : t('展开播放器')}
            aria-expanded={expanded}
            onClick={() => {
              if (expanded) {
                playButton.current?.focus();
                setCollapsed(true);
              }
              expand(!expanded);
            }}
          >
            {expanded ? <Minimize size={17} /> : <Expand size={17} />}
          </Button>
          {choices}
        </div>
      </div>
    </div>
  );
}
