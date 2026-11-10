import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useInterview } from '../../src/stores/interview';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  useInterview.getState().reset();
  useInterview.setState({ sessionId: 'synthetic-shared-draft' });
});
afterEach(() => {
  useInterview.getState().reset();
  vi.unstubAllGlobals();
});
const text = () => useInterview.getState().inputDraft ?? useInterview.getState().draftQuestion;

it('follows new transcription until an explicit edit and versions the visible draft', () => {
  useInterview.setState({ draftQuestion: 'First transcription' });
  const first = useInterview.getState().inputDraftRevision;
  expect(text()).toBe('First transcription');
  useInterview.setState({ draftQuestion: 'Updated transcription' });
  expect(useInterview.getState().inputDraftRevision).toBeGreaterThan(first);
  useInterview.getState().setInputDraft('User question');
  const edited = useInterview.getState().inputDraftRevision;
  useInterview.setState({ draftQuestion: 'Later transcription' });
  expect(text()).toBe('User question');
  expect(useInterview.getState().inputDraftRevision).toBe(edited);
});

it('rejects concurrent stale edits and stale send cleanup without losing the next draft', () => {
  const initial = useInterview.getState().inputDraftRevision;
  expect(useInterview.getState().setInputDraft('Question to send', initial)).toBe(true);
  const submitted = useInterview.getState().inputDraftRevision;
  expect(useInterview.getState().setInputDraft('Stale phone edit', initial)).toBe(false);
  expect(text()).toBe('Question to send');
  expect(useInterview.getState().setInputDraft('Next unsent question', submitted)).toBe(true);
  expect(useInterview.getState().setInputDraft(null, submitted)).toBe(false);
  expect(text()).toBe('Next unsent question');
});

it('suppresses the cleared candidate and resumes autofill only for a changed candidate', () => {
  useInterview.setState({ draftQuestion: 'Candidate' });
  useInterview.getState().setInputDraft('');
  const cleared = useInterview.getState().inputDraftRevision;
  useInterview.setState({ draftQuestion: 'Candidate', generating: true });
  expect(text()).toBe('');
  expect(useInterview.getState().inputDraftRevision).toBe(cleared);
  useInterview.setState({ draftQuestion: 'New candidate' });
  expect(text()).toBe('New candidate');
  expect(useInterview.getState().inputDraft).toBeNull();
  expect(useInterview.getState().inputDraftRevision).toBeGreaterThan(cleared);
});

it('clears draft ownership and composition when the interview changes', () => {
  useInterview.getState().setInputDraft('Old session draft');
  useInterview.getState().setInputDraftComposing(true);
  useInterview.setState({ sessionId: 'synthetic-next-session', draftQuestion: 'New session candidate' });
  expect(text()).toBe('New session candidate');
  expect(useInterview.getState().inputDraftRevision).toBe(0);
  expect(useInterview.getState().inputDraftComposing).toBe(false);
});

it('does not version unchanged manual text and rejects oversized edits', () => {
  useInterview.getState().setInputDraft('Same text');
  const revision = useInterview.getState().inputDraftRevision;
  expect(useInterview.getState().setInputDraft('Same text', revision)).toBe(true);
  expect(useInterview.getState().inputDraftRevision).toBe(revision);
  expect(useInterview.getState().setInputDraft('x'.repeat(6001), revision)).toBe(false);
  expect(text()).toBe('Same text');
});
