export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  CANCELLED = 'CANCELLED',
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

export type WorkflowStage =
  | 'validation'
  | 'preflight'
  | 'optimization'
  | 'upload'
  | 'transcription'
  | 'refinement';

export type WorkflowErrorCode =
  | 'INVALID_FILE'
  | 'INVALID_URL'
  | 'MISSING_CONFIGURATION'
  | 'ENDPOINT_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'ENDPOINT_NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'INCOMPATIBLE_RESPONSE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'EMPTY_RESULT'
  | 'CANCELLED'
  | 'UNKNOWN';

export type WorkflowRecoveryTarget = 'retry' | 'settings' | 'file';
export type CompatibilityTarget = 'cloud' | 'llm' | 'stt';

export interface ActionableWorkflowError {
  code: WorkflowErrorCode;
  stage: WorkflowStage;
  title: string;
  message: string;
  suggestion: string;
  retryable: boolean;
  recovery: WorkflowRecoveryTarget;
  target?: CompatibilityTarget;
  status?: number;
  technicalDetail?: string;
}

export type CompatibilityCheckStatus = 'pass' | 'warning' | 'fail';

export interface CompatibilityCheck {
  target: CompatibilityTarget;
  label: string;
  status: CompatibilityCheckStatus;
  detail: string;
  endpoint?: string;
  model?: string;
  discoveredModels?: string[];
  error?: ActionableWorkflowError;
}

export interface CompatibilityReport {
  status: 'compatible' | 'warning' | 'blocked';
  summary: string;
  checks: CompatibilityCheck[];
  checkedAt: string;
}

export interface TranscriptionRequest {
  file: File;
  provider: ModelProvider;
  localConfig?: LocalConfig;
  customTerms?: string[];
  signal?: AbortSignal;
  resumeTranscript?: string;
}

export interface TranscriptionCallbacks {
  onProgress?: (percent: number) => void;
  onStatusUpdate?: (status: string) => void;
  onStageResult?: (stage: WorkflowStage, text: string) => void;
}

export interface TranscriptionCompletionMetadata {
  source: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    lastModified: number;
  };
  completedAt: string;
  processing: {
    provider: ModelProvider;
    mode: ModelProvider.GEMINI | TranscriptionMode;
    routeTitle: string;
    routeDetail: string;
    routeBadge: string;
    llm: {
      engine: string;
      model: string;
    };
    stt: {
      engine: string;
      model: string;
    } | null;
    configuredLanguage: string;
  };
  termsCount: number;
}
