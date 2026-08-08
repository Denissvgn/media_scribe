import React from 'react';

interface SignalToTextMarkProps {
  className?: string;
  resolved?: boolean;
}

export const SignalToTextMark: React.FC<SignalToTextMarkProps> = ({
  className = '',
  resolved = false
}) => (
  <svg
    className={className}
    viewBox="0 0 320 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <g className="text-indigo-300" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
      <path d="M24 41V55" />
      <path d="M42 31V65" />
      <path d="M60 19V77" />
      <path d="M78 35V61" />
      <path d="M96 25V71" />
      <path d="M114 38V58" />
      <path d="M132 32V64" />
    </g>

    <g className="text-slate-500" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M148 48H182" />
      <path d="M174 40L182 48L174 56" />
    </g>

    <g
      className={resolved ? 'text-emerald-300' : 'text-indigo-200'}
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
    >
      <path d="M202 31H296" />
      <path d="M202 48H274" />
      <path d="M202 65H286" />
    </g>

    {resolved && (
      <g className="text-emerald-300" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="294" cy="76" r="11" className="fill-slate-950/90" />
        <path d="M289 76L293 80L300 72" />
      </g>
    )}
  </svg>
);
