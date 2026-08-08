export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface TranscriptionResult {
  text: string;
  timestamp: number;
}

export enum ModelProvider {
  GEMINI = 'GEMINI',
  LOCAL = 'LOCAL',
}

export enum TranscriptionMode {
  HYBRID = 'HYBRID',
  LOCAL_STT = 'LOCAL_STT',
}

export type LocalEngineType = 'ollama' | 'vllm' | 'lmstudio' | 'custom';
export type STTEngineType = 'faster_whisper' | 'vllm_stt' | 'groq_stt' | 'ollama_stt' | 'custom_stt';

export interface LocalConfig {
  baseUrl: string;
  llmModel: string;
  transcriptionMode: TranscriptionMode;
  sttUrl: string;
  sttModel: string;
  apiKey?: string;
  engineType?: LocalEngineType;
  sttEngine?: STTEngineType;
  sttApiKey?: string;
  sttLanguage?: string;
}
