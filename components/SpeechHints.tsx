import React from 'react';

interface SpeechHintsProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  termsText: string;
  termsList: string[];
  termsFileName: string | null;
  termsError: string | null;
  isDragging: boolean;
  disabled?: boolean;
  onClear: () => void;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragStateChange: (isDragging: boolean) => void;
  onTextChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

export const SpeechHints: React.FC<SpeechHintsProps> = ({
  inputRef,
  termsText,
  termsList,
  termsFileName,
  termsError,
  isDragging,
  disabled = false,
  onClear,
  onFileSelect,
  onFileDrop,
  onDragStateChange,
  onTextChange
}) => (
  <article
    className={`h-full space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 shadow-xl shadow-slate-950/20 sm:p-5 ${disabled ? 'opacity-70' : ''}`}
    aria-labelledby="speech-hints-title"
    aria-disabled={disabled || undefined}
  >
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 id="speech-hints-title" className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <svg className="h-5 w-5 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Speech hints
        </h3>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          {disabled
            ? 'Speech hints are locked for this transcription attempt.'
            : 'Add names or phrases—one per line—to improve recognition and spelling.'}
        </p>
      </div>
      {termsList.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="min-h-11 self-start rounded-lg px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed motion-reduce:transition-none"
        >
          Clear hints
        </button>
      )}
    </div>

    <div className="space-y-2">
      <input
        ref={inputRef}
        id="terms-file-input"
        type="file"
        accept=".txt,text/plain"
        onChange={onFileSelect}
        disabled={disabled}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        id="terms-file-picker-trigger"
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        onDragOver={(event) => {
          event.preventDefault();
          if (disabled) return;
          onDragStateChange(true);
        }}
        onDragLeave={() => onDragStateChange(false)}
        onDrop={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          onFileDrop(event);
        }}
        aria-label="Choose a plain-text speech-hints file"
        aria-describedby="terms-upload-help"
        aria-invalid={Boolean(termsError)}
        aria-errormessage={termsError ? 'terms-upload-error' : undefined}
        className={`
          relative flex min-h-24 w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center
          transition-colors duration-200 motion-reduce:transform-none motion-reduce:transition-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300
          focus-visible:ring-offset-4 focus-visible:ring-offset-slate-900
          disabled:pointer-events-none disabled:cursor-not-allowed
          ${isDragging
            ? 'border-indigo-300 bg-indigo-500/10 motion-safe:scale-[1.01]'
            : 'border-slate-500 bg-slate-950/20 hover:border-indigo-300 hover:bg-slate-950/40'
          }
        `}
      >
        <span className="pointer-events-none flex flex-col items-center justify-center space-y-1.5">
          <svg className="h-6 w-6 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span className="max-w-full break-words text-sm font-medium text-slate-200">
            {isDragging
              ? 'Drop the .txt file here'
              : termsFileName
                ? `Loaded: ${termsFileName}`
                : 'Choose a .txt file'}
          </span>
          <span id="terms-upload-help" className="text-xs leading-relaxed text-slate-400">
            Press Enter or Space to browse, or drag and drop
          </span>
        </span>
      </button>

      {termsError && (
        <p id="terms-upload-error" className="text-sm leading-relaxed text-red-200" role="alert" aria-atomic="true">
          {termsError}
        </p>
      )}
    </div>

    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-300">
        <label htmlFor="terms-inline-input">Type or paste hints</label>
        {termsList.length > 0 && (
          <span className="flex items-center gap-1 rounded border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 font-mono text-xs normal-case text-indigo-300">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" aria-hidden="true" />
            {termsList.length} hint{termsList.length === 1 ? '' : 's'} active
          </span>
        )}
      </div>
      <textarea
        id="terms-inline-input"
        rows={4}
        value={termsText}
        onChange={onTextChange}
        disabled={disabled}
        aria-describedby="terms-inline-help"
        className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base leading-relaxed text-slate-200 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed sm:text-sm"
        placeholder={`Type or paste one name or phrase per line:
DenisSvgn
Google Gemini
DeepMind
Ollama`}
      />
      <p id="terms-inline-help" className="text-xs text-slate-400">One name or phrase per line.</p>
    </div>
  </article>
);
