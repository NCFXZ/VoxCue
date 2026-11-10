import type { InterviewConfiguration, InterviewInputMode } from '../../electron/contracts/speech';

export type { InterviewInputMode } from '../../electron/contracts/speech';

// The saved configuration retains the remote device/source preferences. Only
// the configuration sent to an interview applies the selected input mode.
export function resolveInterviewInput(
  configuration: InterviewConfiguration,
  inputMode: InterviewInputMode,
) {
  const value = structuredClone(configuration);
  value.inputMode = inputMode;
  if (inputMode === 'transcription') value.options.sources = ['microphone'];
  return value;
}
