import React, { useCallback, useRef, useState } from 'react';
import { MAX_FILE_SIZE_MIB, MEDIA_FILE_ACCEPT } from '../constants';
import { validateMediaFile } from '../mediaValidation';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

const MEDIA_INPUT_ID = 'media-file-input';
const MEDIA_TRIGGER_ID = 'media-file-picker-trigger';
const MEDIA_INSTRUCTIONS_ID = 'media-upload-instructions';
const MEDIA_FORMATS_ID = 'media-upload-formats';
const MEDIA_ERROR_ID = 'media-upload-error';

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectFile = useCallback((selectedFile: File) => {
    const validationResult = validateMediaFile(selectedFile);
    if (validationResult.valid === false) {
      setValidationError(validationResult.message);
      return;
    }

    setValidationError(null);
    onFileSelect(selectedFile);
  }, [onFileSelect]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const selectedFile = event.dataTransfer.files?.[0];
    if (selectedFile) selectFile(selectedFile);
  }, [disabled, selectFile]);

  const handleFileInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) selectFile(selectedFile);
    event.target.value = '';
  }, [selectFile]);

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        id={MEDIA_INPUT_ID}
        type="file"
        accept={MEDIA_FILE_ACCEPT}
        className="hidden"
        onChange={handleFileInput}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        id={MEDIA_TRIGGER_ID}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={disabled}
        aria-label="Choose an audio or video file"
        aria-describedby={`${MEDIA_INSTRUCTIONS_ID} ${MEDIA_FORMATS_ID}`}
        aria-invalid={Boolean(validationError)}
        aria-errormessage={validationError ? MEDIA_ERROR_ID : undefined}
        className={`
          group relative flex min-h-56 w-full cursor-pointer flex-col items-center justify-center sm:min-h-64
          rounded-2xl border-2 border-dashed px-4 py-6 text-center sm:py-8
          transition-colors duration-200 motion-reduce:transform-none motion-reduce:transition-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300
          focus-visible:ring-offset-4 focus-visible:ring-offset-slate-900
          disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50
          ${isDragging
            ? 'border-indigo-300 bg-indigo-500/10 motion-safe:scale-[1.02]'
            : 'border-slate-500 bg-slate-800/20 hover:border-indigo-300 hover:bg-slate-800/50'
          }
        `}
      >
        <div className="pointer-events-none flex min-w-0 max-w-full flex-col items-center justify-center space-y-4">
          <div className={`rounded-full bg-slate-800 p-4 shadow-xl transition-transform duration-200 motion-reduce:transform-none motion-reduce:transition-none ${isDragging ? 'motion-safe:scale-110' : 'motion-safe:group-hover:scale-110'}`}>
            <svg className="h-8 w-8 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v-4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-lg font-medium text-slate-100">
              {isDragging ? 'Drop your audio or video here' : 'Choose audio or video'}
            </p>
            <p id={MEDIA_INSTRUCTIONS_ID} className="text-sm leading-relaxed text-slate-300">
              Press Enter or Space to browse, or drag and drop a file
            </p>
          </div>
          <p id={MEDIA_FORMATS_ID} className="max-w-full break-words rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-400">
            Supported formats: WebM, Ogg/OGX, MP4, MOV, and WAV · Up to {MAX_FILE_SIZE_MIB} MiB
          </p>
        </div>
      </button>

      {validationError && (
        <p id={MEDIA_ERROR_ID} className="text-sm leading-relaxed text-red-200" role="alert" aria-atomic="true">
          {validationError}
        </p>
      )}
    </div>
  );
};
