import React, { useCallback, useState, useRef } from 'react';
import { ACCEPTED_MIME_TYPES } from '../constants';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      
      // Check if the mime type starts with allowed types (ignoring parameters like ;codecs=...)
      // Or if the extension is .webm, .ogx, .mp4, or .mov (fallback for when browser doesn't detect mime type correctly)
      const isMimeTypeValid = ACCEPTED_MIME_TYPES.some(type => file.type.startsWith(type));
      const isExtensionValid = 
        file.name.toLowerCase().endsWith('.webm') || 
        file.name.toLowerCase().endsWith('.ogx') || 
        file.name.toLowerCase().endsWith('.mp4') ||
        file.name.toLowerCase().endsWith('.mov');

      if (isMimeTypeValid || isExtensionValid) {
        onFileSelect(file);
      } else {
        alert("Please upload a valid .webm, .ogx, .mp4, or .mov file");
      }
    }
  }, [onFileSelect, disabled]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`
        relative group cursor-pointer
        flex flex-col items-center justify-center
        w-full h-64 rounded-2xl
        border-2 border-dashed transition-all duration-300 ease-in-out
        ${isDragging 
          ? 'border-indigo-400 bg-indigo-500/10 scale-[1.02]' 
          : 'border-slate-600 hover:border-indigo-400 hover:bg-slate-800/50 bg-slate-800/20'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MIME_TYPES.join(',')}
        className="hidden"
        onChange={handleFileInput}
        disabled={disabled}
      />
      
      <div className="flex flex-col items-center justify-center space-y-4 text-center p-6">
        <div className={`p-4 rounded-full bg-slate-800 shadow-xl transition-transform duration-300 ${isDragging ? 'scale-110' : 'group-hover:scale-110'}`}>
          <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v-4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium text-slate-200">
            {isDragging ? 'Drop your audio/video here' : 'Upload .webm, .ogx, .mp4, or .mov'}
          </p>
          <p className="text-sm text-slate-400">
            Drag & drop or click to browse
          </p>
        </div>
        <div className="text-xs text-slate-500 font-mono bg-slate-900/50 px-2 py-1 rounded">
          Supported: .webm, .ogx, .mp4, .mov
        </div>
      </div>
    </div>
  );
};
