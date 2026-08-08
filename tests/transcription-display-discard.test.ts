import assert from 'node:assert/strict';
import test from 'node:test';
import { getTranscriptDiscardState } from '../components/TranscriptionDisplay.tsx';

const deriveState = (overrides: Partial<Parameters<typeof getTranscriptDiscardState>[0]> = {}) => (
  getTranscriptDiscardState({
    text: '',
    originalText: '',
    title: '',
    notes: '',
    defaultTitle: 'Weekly meeting',
    ...overrides
  })
);

test('normalizes semantically blank title and notes before checking for changes', () => {
  for (const title of ['', '   ', '  Weekly meeting  ']) {
    const state = deriveState({ title, notes: ' \n\t ' });

    assert.equal(state.resolvedTitle, 'Weekly meeting');
    assert.equal(state.normalizedNotes, '');
    assert.equal(state.titleChanged, false);
    assert.equal(state.hasNotes, false);
    assert.equal(state.shouldConfirmDiscard, false);
  }
});

test('protects an unchanged generated transcript', () => {
  const state = deriveState({
    text: 'Generated transcript',
    originalText: 'Generated transcript'
  });

  assert.equal(state.hasGeneratedTranscript, true);
  assert.equal(state.transcriptChanged, false);
  assert.equal(state.shouldConfirmDiscard, true);
});

test('protects cleared, edited, and manually entered transcript content', () => {
  const cases = [
    { text: '', originalText: 'Generated transcript' },
    { text: 'Edited transcript', originalText: 'Generated transcript' },
    { text: 'Manual transcript', originalText: '' }
  ];

  for (const transcript of cases) {
    const state = deriveState(transcript);

    assert.equal(state.transcriptChanged, true);
    assert.equal(state.shouldConfirmDiscard, true);
  }
});

test('protects a custom title or non-whitespace notes', () => {
  const customTitle = deriveState({ title: 'Customer interview' });
  const notes = deriveState({ notes: 'Follow up with the speaker.' });

  assert.equal(customTitle.titleChanged, true);
  assert.equal(customTitle.shouldConfirmDiscard, true);
  assert.equal(notes.hasNotes, true);
  assert.equal(notes.shouldConfirmDiscard, true);
});
