import React, { useState } from 'react';
import { Button } from './Button';

interface TranscriptionDisplayProps {
  text: string;
}

export const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="w-full bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl overflow-hidden flex flex-col h-full shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-800/80">
        <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
          <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Transcription Result
        </h3>
        <Button 
          variant="secondary" 
          onClick={handleCopy}
          className="!py-1.5 !text-sm !px-3"
          title="Copy to clipboard"
        >
          {copied ? (
            <span className="flex items-center gap-1.5 text-green-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              Copy
            </span>
          )}
        </Button>
      </div>
      <div className="p-6 overflow-y-auto max-h-[500px] scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
        <div className="prose prose-invert prose-lg max-w-none whitespace-pre-wrap text-slate-300 leading-relaxed font-light">
          {text}
        </div>
      </div>
    </div>
  );
};
