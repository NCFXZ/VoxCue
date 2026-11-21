import { memo } from 'react';
import type { Transcript } from '../services/contracts';
import type { InterviewInputMode } from '../../electron/contracts/speech';
import { t } from '../i18n';
import { useGeneralSettings } from '../stores/generalSettings';

const TranscriptRow = memo(function TranscriptRow({ transcript, interviewee, speaker, caret, gap }: {
  transcript: Transcript;
  interviewee: boolean;
  speaker: string;
  caret: boolean;
  gap: string;
}) {
  return (
    <article className={`transcript-item ${interviewee ? 'interviewee' : 'interviewer'}`}>
      <div className="transcript-meta">
        <strong>{speaker}</strong>
        <time>{transcript.time}</time>
      </div>
      <p>{transcript.text}{caret && <span className="typing-caret" />}</p>
      {transcript.reason === 'discontinuity' && <small className="transcript-gap">{gap}</small>}
    </article>
  );
});

export const FloatingTranscripts = memo(function FloatingTranscripts({ transcripts, inputMode, running }: {
  transcripts: Transcript[];
  inputMode: InterviewInputMode;
  running: boolean;
}) {
  useGeneralSettings(state => state.language);
  const interviewer = t('面试官'), microphone = t(inputMode === 'transcription' ? '麦克风' : '面试者');
  const gap = t('音频间断，片段可能不完整');
  return transcripts.map(transcript => (
    <TranscriptRow key={transcript.id} transcript={transcript}
      interviewee={transcript.source === 'microphone' && inputMode !== 'transcription'}
      speaker={transcript.source === 'microphone' ? microphone : interviewer}
      caret={!transcript.final && running} gap={gap} />
  ));
});
