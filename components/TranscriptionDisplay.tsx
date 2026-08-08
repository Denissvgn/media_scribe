import React, { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import { SignalToTextMark } from './SignalToTextMark';
import { TranscriptionCompletionMetadata } from '../types';

type ExportFormat = 'txt' | 'md' | 'json';

interface TranscriptionDisplayProps {
  text: string;
  originalText: string;
  title: string;
  notes: string;
  metadata: TranscriptionCompletionMetadata;
  onTextChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onTranscribeAnother: () => void;
  headingLevel?: 'h2' | 'h3';
}

const getDefaultTitle = (fileName: string) => {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, '').trim();
  return withoutExtension || fileName || 'Untitled transcript';
};

interface TranscriptDiscardStateInput {
  text: string;
  originalText: string;
  title: string;
  notes: string;
  defaultTitle: string;
}

export const getTranscriptDiscardState = ({
  text,
  originalText,
  title,
  notes,
  defaultTitle
}: TranscriptDiscardStateInput) => {
  const normalizedDefaultTitle = defaultTitle.trim() || 'Untitled transcript';
  const resolvedTitle = title.trim() || normalizedDefaultTitle;
  const normalizedNotes = notes.trim();
  const hasGeneratedTranscript = originalText.trim().length > 0;
  const transcriptChanged = text !== originalText;
  const titleChanged = resolvedTitle !== normalizedDefaultTitle;
  const hasNotes = normalizedNotes.length > 0;

  return {
    resolvedTitle,
    normalizedNotes,
    hasGeneratedTranscript,
    transcriptChanged,
    titleChanged,
    hasNotes,
    shouldConfirmDiscard: hasGeneratedTranscript || transcriptChanged || titleChanged || hasNotes
  };
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 bytes';
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const formatDate = (isoDate: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(new Date(isoDate));

const formatLanguage = (language: string) => {
  if (!language || language.toLowerCase() === 'auto') return 'Automatic (no override)';
  return language.toUpperCase();
};

const cleanMarkdownValue = (value: string) => value.replace(/\r?\n/g, ' ').trim();

const sanitizeDownloadName = (title: string, fallback: string) => {
  const candidate = (title.trim() || getDefaultTitle(fallback))
    .replace(/\.(txt|md|markdown|json)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
    .trim();

  return candidate || 'transcript';
};

export const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({
  text,
  originalText,
  title,
  notes,
  metadata,
  onTextChange,
  onTitleChange,
  onNotesChange,
  onTranscribeAnother,
  headingLevel = 'h2'
}) => {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');
  const [feedback, setFeedback] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const cancelDiscardRef = useRef<HTMLButtonElement | null>(null);
  const idPrefix = useId();

  const defaultTitle = getDefaultTitle(metadata.source.fileName);
  const discardState = getTranscriptDiscardState({
    text,
    originalText,
    title,
    notes,
    defaultTitle
  });
  const {
    resolvedTitle: displayTitle,
    normalizedNotes,
    transcriptChanged,
    shouldConfirmDiscard
  } = discardState;
  const hasDraft = text.trim().length > 0;
  const modelPath = metadata.processing.stt
    ? `${metadata.processing.stt.engine} / ${metadata.processing.stt.model} → ${metadata.processing.llm.engine} / ${metadata.processing.llm.model}`
    : `${metadata.processing.llm.engine} / ${metadata.processing.llm.model}`;
  const CompletionHeading = headingLevel;

  useEffect(() => {
    headingRef.current?.focus();
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (confirmDiscard) cancelDiscardRef.current?.focus();
  }, [confirmDiscard]);

  const announce = (message: string, tone: 'success' | 'error' = 'success') => {
    setFeedback({ message, tone });
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 3500);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      announce('Transcript copied to the clipboard.');
    } catch (error) {
      console.error('Failed to copy transcript:', error);
      announce('Could not copy the transcript. Select the text and copy it manually.', 'error');
    }
  };

  const buildExport = () => {
    if (exportFormat === 'txt') {
      return {
        content: text,
        mimeType: 'text/plain;charset=utf-8',
        extension: 'txt'
      };
    }

    if (exportFormat === 'md') {
      const noteContent = normalizedNotes || '_No notes added._';
      const sourceName = cleanMarkdownValue(metadata.source.fileName);
      const mimeType = cleanMarkdownValue(metadata.source.mimeType);
      const route = cleanMarkdownValue(metadata.processing.routeTitle);
      const pipeline = cleanMarkdownValue(metadata.processing.routeDetail);

      return {
        content: [
          `# ${displayTitle}`,
          '',
          '## Details',
          '',
          `- Source file: ${sourceName}`,
          `- File type: ${mimeType}`,
          `- File size: ${formatBytes(metadata.source.sizeBytes)}`,
          `- Completed: ${formatDate(metadata.completedAt)}`,
          `- Processing route: ${route}`,
          `- Route details: ${pipeline}`,
          `- Models: ${cleanMarkdownValue(modelPath)}`,
          `- Configured language: ${formatLanguage(metadata.processing.configuredLanguage)}`,
          `- Speech hints used: ${metadata.termsCount}`,
          '',
          '## Notes',
          '',
          noteContent,
          '',
          '## Transcript',
          '',
          text
        ].join('\n'),
        mimeType: 'text/markdown;charset=utf-8',
        extension: 'md'
      };
    }

    return {
      content: JSON.stringify({
        artifactType: 'media-scribe-transcript',
        schemaVersion: 1,
        title: displayTitle,
        notes: normalizedNotes,
        source: {
          ...metadata.source,
          lastModifiedAt: new Date(metadata.source.lastModified).toISOString()
        },
        completedAt: metadata.completedAt,
        processing: metadata.processing,
        speechHints: {
          termsCount: metadata.termsCount
        },
        metrics: {
          characters: text.length
        },
        transcript: {
          current: text,
          original: originalText
        }
      }, null, 2),
      mimeType: 'application/json;charset=utf-8',
      extension: 'json'
    };
  };

  const handleDownload = () => {
    try {
      const artifact = buildExport();
      const blob = new Blob([artifact.content], { type: artifact.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${sanitizeDownloadName(displayTitle, metadata.source.fileName)}.${artifact.extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce(`${artifact.extension.toUpperCase()} export downloaded.`);
    } catch (error) {
      console.error('Failed to download transcript:', error);
      announce('Could not create the export. Try a different format or copy the transcript.', 'error');
    }
  };

  const handleRevert = () => {
    onTextChange(originalText);
    announce('Transcript restored to the generated version.');
  };

  const handleTranscribeAnother = () => {
    if (shouldConfirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onTranscribeAnother();
  };

  const closeDiscardConfirmation = () => {
    setConfirmDiscard(false);
    window.requestAnimationFrame(() => {
      document.getElementById(`${idPrefix}-next-file`)?.focus();
    });
  };

  return (
    <section
      className="relative w-full overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70"
      aria-labelledby={`${idPrefix}-completion-title`}
    >
      <span className="absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-emerald-300/90 to-transparent" aria-hidden="true" />
      <header className="relative overflow-hidden border-b border-slate-800 bg-gradient-to-br from-emerald-950/50 via-slate-900 to-indigo-950/40 px-5 py-6 sm:px-7 sm:py-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/35 bg-emerald-500/15 text-emerald-200">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-center gap-3">
                <CompletionHeading
                  id={`${idPrefix}-completion-title`}
                  ref={headingRef}
                  tabIndex={-1}
                  className="rounded font-editorial text-3xl font-semibold leading-[1.02] tracking-[-0.025em] text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-4 focus-visible:ring-offset-slate-900 sm:text-4xl"
                >
                  Transcription complete
                </CompletionHeading>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/25">
                  Ready to edit
                </span>
              </div>
              <p className="mt-2 max-w-[55ch] break-words font-editorial text-base leading-7 text-emerald-100/80">
                “{displayTitle}” is ready to review, correct, and export.
              </p>
            </div>
          </div>

          <SignalToTextMark resolved className="media-scribe-signal-resolve h-20 w-full lg:h-24" />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-emerald-200/10 pt-4 text-sm sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="font-mono text-xs font-medium text-emerald-50/80">Characters</dt>
            <dd className="mt-1 font-mono font-medium tabular-nums text-slate-100">{text.length.toLocaleString()}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-mono text-xs font-medium text-emerald-50/80">Processing route</dt>
            <dd className="mt-1 break-words font-medium text-slate-100">{metadata.processing.routeBadge}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-mono text-xs font-medium text-emerald-50/80">Speech hints</dt>
            <dd className="mt-1 font-mono font-medium tabular-nums text-slate-100">{metadata.termsCount}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-mono text-xs font-medium text-emerald-50/80">Completed</dt>
            <dd className="mt-1 break-words font-mono text-xs font-medium leading-5 text-slate-100">
              <time dateTime={metadata.completedAt}>{formatDate(metadata.completedAt)}</time>
            </dd>
          </div>
        </dl>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5 p-5 sm:p-6">
          <div className="space-y-2">
            <label htmlFor={`${idPrefix}-title`} className="block text-sm font-medium text-slate-200">
              Transcript title
            </label>
            <input
              id={`${idPrefix}-title`}
              type="text"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="min-h-11 w-full max-w-[72ch] rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-editorial text-xl font-semibold leading-7 text-slate-100 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder={defaultTitle}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label htmlFor={`${idPrefix}-editor`} className="block text-sm font-medium text-slate-200">
                Transcript
              </label>
              <button
                type="button"
                onClick={handleRevert}
                disabled={!transcriptChanged}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
              >
                Revert generated text
              </button>
            </div>
            <textarea
              id={`${idPrefix}-editor`}
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              aria-describedby={`${idPrefix}-editor-help ${idPrefix}-character-count`}
              className="min-h-[26rem] w-full max-w-[72ch] resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-editorial text-lg leading-8 text-slate-100 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="The generated transcript was empty. You can add text here manually."
              spellCheck="true"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <p id={`${idPrefix}-editor-help`}>This working transcript is not saved across reloads; download a copy before leaving.</p>
              <p id={`${idPrefix}-character-count`} className="font-medium tabular-nums text-slate-300">
                {text.length.toLocaleString()} character{text.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </div>

        <aside className="border-t border-slate-800 bg-slate-950/35 p-5 sm:p-6 lg:border-l lg:border-t-0" aria-labelledby={`${idPrefix}-details-title`}>
          <h3 id={`${idPrefix}-details-title`} className="text-base font-semibold text-slate-100">Transcript details</h3>

          <dl className="mt-4 divide-y divide-slate-800 text-sm">
            <div className="py-3 first:pt-0">
              <dt className="text-xs font-medium text-slate-400">Source file</dt>
              <dd className="mt-1 break-words text-slate-200 [overflow-wrap:anywhere]">{metadata.source.fileName}</dd>
            </div>
            <div className="py-3">
              <dt className="text-xs font-medium text-slate-400">Type and size</dt>
              <dd className="mt-1 break-words text-slate-200">{metadata.source.mimeType} · {formatBytes(metadata.source.sizeBytes)}</dd>
            </div>
            <div className="py-3">
              <dt className="text-xs font-medium text-slate-400">Completed</dt>
              <dd className="mt-1 text-slate-200">
                <time dateTime={metadata.completedAt}>{formatDate(metadata.completedAt)}</time>
              </dd>
            </div>
            <div className="py-3">
              <dt className="text-xs font-medium text-slate-400">Processing route</dt>
              <dd className="mt-1 break-words text-slate-200 [overflow-wrap:anywhere]">{metadata.processing.routeTitle}</dd>
              <dd className="mt-1 break-words text-xs leading-relaxed text-slate-400 [overflow-wrap:anywhere]">{metadata.processing.routeDetail}</dd>
            </div>
            <div className="py-3">
              <dt className="text-xs font-medium text-slate-400">Model path</dt>
              <dd className="mt-1 break-words text-slate-200 [overflow-wrap:anywhere]">{modelPath}</dd>
            </div>
            <div className="py-3">
              <dt className="text-xs font-medium text-slate-400">Configured language</dt>
              <dd className="mt-1 text-slate-200">{formatLanguage(metadata.processing.configuredLanguage)}</dd>
            </div>
            <div className="py-3">
              <dt className="text-xs font-medium text-slate-400">Speech hints</dt>
              <dd className="mt-1 text-slate-200">{metadata.termsCount} hint{metadata.termsCount === 1 ? '' : 's'} used</dd>
            </div>
          </dl>

          <div className="mt-5 space-y-2">
            <label htmlFor={`${idPrefix}-notes`} className="block text-sm font-medium text-slate-200">
              Notes
            </label>
            <textarea
              id={`${idPrefix}-notes`}
              rows={5}
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
              className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base leading-6 text-slate-200 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 sm:text-sm"
              placeholder="Add context for this transcript…"
            />
          </div>
        </aside>
      </div>

      <footer className="border-t border-slate-800 bg-slate-900 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopy}
              disabled={!hasDraft}
              className="min-h-11 w-full gap-2 sm:w-auto"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
              </svg>
              Copy draft
            </Button>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:items-end">
              <div className="min-w-0 space-y-1.5">
                <label htmlFor={`${idPrefix}-format`} className="block text-xs font-medium text-slate-400">Export format</label>
                <select
                  id={`${idPrefix}-format`}
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
                  className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-slate-200 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 sm:w-36 sm:text-sm"
                >
                  <option value="txt">Plain text (.txt)</option>
                  <option value="md">Markdown (.md)</option>
                  <option value="json">JSON (.json)</option>
                </select>
              </div>
              <Button
                type="button"
                onClick={handleDownload}
                disabled={!hasDraft}
                className="min-h-11 gap-2 whitespace-nowrap"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-5-4 4m0 0-4-4m4 4V4" />
                </svg>
                Download
              </Button>
            </div>
          </div>

          <Button
            id={`${idPrefix}-next-file`}
            type="button"
            variant="ghost"
            onClick={handleTranscribeAnother}
            className="min-h-11 w-full gap-2 ring-1 ring-inset ring-slate-700 lg:w-auto"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Transcribe another file
          </Button>
        </div>

        <div className="mt-3 min-h-5" role="status" aria-live="polite" aria-atomic="true">
          {feedback && (
            <p className={`text-sm ${feedback.tone === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>
              {feedback.message}
            </p>
          )}
        </div>

        {confirmDiscard && (
          <div
            className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 p-4"
            role="alert"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeDiscardConfirmation();
            }}
          >
            <p className="font-medium text-amber-100">Discard this transcript?</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-200/80">
              Starting another file clears the transcript, title, and notes. Download anything you want to keep first.
            </p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelDiscardRef}
                type="button"
                onClick={closeDiscardConfirmation}
                className="min-h-11 rounded-lg px-4 text-sm font-medium text-slate-200 ring-1 ring-inset ring-slate-600 transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onTranscribeAnother}
                className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-900"
              >
                Discard and transcribe another
              </button>
            </div>
          </div>
        )}
      </footer>

      <style>{`
        @keyframes media-scribe-signal-resolve {
          0% {
            clip-path: inset(0 68% 0 0);
            filter: blur(1.5px);
            opacity: 0.68;
          }
          100% {
            clip-path: inset(0 0 0 0);
            filter: blur(0);
            opacity: 1;
          }
        }
        .media-scribe-signal-resolve {
          animation: media-scribe-signal-resolve 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .media-scribe-signal-resolve {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
};
