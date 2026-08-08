import {
  ACCEPTED_MEDIA_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MIB
} from './constants';

export interface MediaFileLike {
  name: string;
  type?: string;
  size: number;
}

export type MediaValidationErrorCode =
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FILE_TOO_LARGE';

export type MediaValidationResult =
  | { valid: true }
  | {
      valid: false;
      code: MediaValidationErrorCode;
      message: string;
    };

const EMPTY_FILE_MESSAGE = 'This file is empty. Choose a media file that contains audio or video.';
const UNSUPPORTED_MEDIA_MESSAGE = 'This file type is not supported. Choose a WebM, Ogg/OGX, MP4, MOV, or WAV file.';
const FILE_TOO_LARGE_MESSAGE = `This file is larger than ${MAX_FILE_SIZE_MIB} MiB. Choose a smaller file and try again.`;

const normalizeMimeType = (type = '') => type.split(';', 1)[0].trim().toLowerCase();

export const validateMediaFile = (file: MediaFileLike): MediaValidationResult => {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      valid: false,
      code: 'EMPTY_FILE',
      message: EMPTY_FILE_MESSAGE
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      code: 'FILE_TOO_LARGE',
      message: FILE_TOO_LARGE_MESSAGE
    };
  }

  const normalizedName = file.name.trim().toLowerCase();
  const normalizedType = normalizeMimeType(file.type);
  const hasAcceptedExtension = ACCEPTED_MEDIA_EXTENSIONS.some(extension => normalizedName.endsWith(extension));
  const hasAcceptedMimeType = ACCEPTED_MIME_TYPES.some(type => normalizedType === type);

  if (!hasAcceptedExtension && !hasAcceptedMimeType) {
    return {
      valid: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: UNSUPPORTED_MEDIA_MESSAGE
    };
  }

  return { valid: true };
};
