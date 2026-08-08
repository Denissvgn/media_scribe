export const GEMINI_MODEL = 'gemini-flash-latest';

export const ACCEPTED_MIME_TYPES = [
  'audio/webm',
  'video/webm',
  'application/ogg',
  'audio/ogg',
  'video/ogg',
  'audio/mp4',
  'video/mp4',
  'application/mp4',
  'audio/quicktime',
  'video/quicktime',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/vnd.wave'
] as const;

export const ACCEPTED_MEDIA_EXTENSIONS = [
  '.webm',
  '.ogg',
  '.ogx',
  '.mp4',
  '.mov',
  '.wav'
] as const;

export const MEDIA_FILE_ACCEPT = [
  ...ACCEPTED_MIME_TYPES,
  ...ACCEPTED_MEDIA_EXTENSIONS
].join(',');

export const MAX_FILE_SIZE_MIB = 500;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MIB * 1024 * 1024;

// Kept for compatibility with existing imports. The limit is measured in MiB.
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_MIB;
