import React, { useState, useEffect, useRef } from 'react';
import { FileUploader } from './components/FileUploader';
import { SpeechHints } from './components/SpeechHints';
import { TranscriptionDisplay } from './components/TranscriptionDisplay';
import { SignalToTextMark } from './components/SignalToTextMark';
import {
  ActionableWorkflowError,
  AppStatus,
  CompatibilityReport,
  LocalConfig,
  LocalEngineType,
  ModelProvider,
  STTEngineType,
  TranscriptionCompletionMetadata,
  TranscriptionMode
} from './types';
import {
  fetchLocalModels,
  fetchLocalSTTModels,
  isAbortError,
  normalizeTranscriptionError,
  preflightTranscriptionRoute,
  transcribeAudio
} from './services/geminiService';
import { Button } from './components/Button';
import {
  ExpertSettings,
  ExpertSectionId,
  RouteOutcome
} from './components/ExpertSettings';
import { validateMediaFile } from './mediaValidation';
import { GEMINI_MODEL } from './constants';

const getDefaultTranscriptTitle = (fileName: string) => {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, '').trim();
  return withoutExtension || fileName || 'Untitled transcript';
};

const formatFileSize = (sizeBytes: number) => {
  if (sizeBytes < 1024) return `${sizeBytes} ${sizeBytes === 1 ? 'byte' : 'bytes'}`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const scopedRouteFingerprint = (fingerprint: string, refinementOnly: boolean) => (
  `${fingerprint}::${refinementOnly ? 'refinement' : 'full-route'}`
);

interface WorkflowStageHeaderProps {
  number: number;
  id: string;
  title: string;
  description: string;
  focusable?: boolean;
  state?: 'current' | 'complete' | 'upcoming';
}

const WorkflowStageHeader: React.FC<WorkflowStageHeaderProps> = ({
  number,
  id,
  title,
  description,
  focusable = false,
  state = 'upcoming'
}) => {
  const markerStyles = state === 'complete'
    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
    : state === 'current'
      ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
      : 'border-slate-700 bg-slate-900 text-slate-400';

  return (
  <header className="mb-4 flex items-start gap-3" aria-current={state === 'current' ? 'step' : undefined}>
    <span
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-sm font-medium tabular-nums ${markerStyles}`}
      aria-hidden="true"
    >
      {number}
      {state === 'complete' && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-emerald-300" />
      )}
    </span>
    <div className="min-w-0 pt-0.5">
      <h2
        id={id}
        tabIndex={focusable ? -1 : undefined}
        className="rounded font-editorial text-2xl font-semibold leading-tight tracking-[-0.02em] text-slate-50 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-4 focus-visible:ring-offset-slate-950"
      >
        {title}
        <span className="sr-only">
          {state === 'complete' ? ' — complete' : state === 'current' ? ' — current step' : ' — upcoming'}
        </span>
      </h2>
      <p className="mt-1 max-w-[65ch] text-base leading-6 text-slate-400">{description}</p>
    </div>
  </header>
  );
};

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [file, setFile] = useState<File | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [generatedTranscription, setGeneratedTranscription] = useState<string>('');
  const [transcriptTitle, setTranscriptTitle] = useState<string>('');
  const [transcriptNotes, setTranscriptNotes] = useState<string>('');
  const [completionMetadata, setCompletionMetadata] = useState<TranscriptionCompletionMetadata | null>(null);
  const [error, setError] = useState<ActionableWorkflowError | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [routeCheck, setRouteCheck] = useState<{ status: 'idle' | 'checking' | 'complete'; report: CompatibilityReport | null }>({ status: 'idle', report: null });
  const [routeCheckFingerprint, setRouteCheckFingerprint] = useState('');
  const [partialTranscription, setPartialTranscription] = useState('');
  const [partialMetadata, setPartialMetadata] = useState<TranscriptionCompletionMetadata | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState({ id: 0, message: '' });
  const requestVersionRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const routeCheckControllerRef = useRef<AbortController | null>(null);
  const processingRegionRef = useRef<HTMLDivElement | null>(null);
  const errorRegionRef = useRef<HTMLDivElement | null>(null);
  const termsInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSettingsFocusRef = useRef<string | null>(null);

  const [termsText, setTermsText] = useState<string>('');
  const [termsList, setTermsList] = useState<string[]>([]);
  const [termsFileName, setTermsFileName] = useState<string | null>(null);
  const [isDraggingTerms, setIsDraggingTerms] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);

  const announceStatus = (message: string) => {
    setLiveAnnouncement(current => ({ id: current.id + 1, message }));
  };

  const parseAndSetTerms = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    setTermsList(lines);
    setTermsText(text);
    return lines.length;
  };

  const loadTermsFile = (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.txt') && selectedFile.type !== 'text/plain') {
      setTermsError('Choose a plain-text speech-hints file (.txt), then try again.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== 'string') {
        setTermsError('The speech-hints file could not be read as text. Choose another file.');
        return;
      }

      const termCount = parseAndSetTerms(result);
      setTermsFileName(selectedFile.name);
      setTermsError(null);
      announceStatus(`Loaded ${termCount} speech ${termCount === 1 ? 'hint' : 'hints'} from ${selectedFile.name}.`);
    };
    reader.onerror = () => {
      setTermsError('The speech-hints file could not be read. Choose another file and try again.');
    };
    reader.readAsText(selectedFile);
  };

  const handleTermsFileDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDraggingTerms(false);
    const selectedFile = e.dataTransfer.files?.[0];
    if (selectedFile) loadTermsFile(selectedFile);
  };

  const handleTermsFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) loadTermsFile(selectedFile);
    e.target.value = '';
  };

  const handleTermsTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    parseAndSetTerms(value);
    setTermsFileName(null);
    setTermsError(null);
  };

  const handleClearTerms = () => {
    const hadTerms = termsList.length > 0;
    setTermsText('');
    setTermsList([]);
    setTermsFileName(null);
    setTermsError(null);
    if (hadTerms) announceStatus('Speech hints cleared.');
  };

  const [provider, setProvider] = useState<ModelProvider>(() => {
    const saved = localStorage.getItem('model_provider');
    return saved ? (saved as ModelProvider) : ModelProvider.LOCAL;
  });

  const [localConfig, setLocalConfig] = useState<LocalConfig>(() => {
    const saved = localStorage.getItem('local_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          baseUrl: parsed.baseUrl || 'http://localhost:8000/v1',
          llmModel: parsed.llmModel || 'gemma4',
          transcriptionMode: parsed.transcriptionMode || TranscriptionMode.LOCAL_STT,
          sttUrl: parsed.sttUrl || 'http://localhost:1234/v1',
          sttModel: parsed.sttModel || 'whisper-large-v3-turbo',
          apiKey: parsed.apiKey || '',
          engineType: parsed.engineType || 'vllm',
          sttEngine: parsed.sttEngine || 'faster_whisper',
          sttApiKey: parsed.sttApiKey || '',
          sttLanguage: parsed.sttLanguage || 'auto'
        };
      } catch (e) {}
    }
    return {
      baseUrl: 'http://localhost:8000/v1',
      llmModel: 'gemma4',
      transcriptionMode: TranscriptionMode.LOCAL_STT,
      sttUrl: 'http://localhost:1234/v1',
      sttModel: 'whisper-large-v3-turbo',
      apiKey: '',
      engineType: 'vllm',
      sttEngine: 'faster_whisper',
      sttApiKey: '',
      sttLanguage: 'auto'
    };
  });

  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [fetchModelsStatus, setFetchModelsStatus] = useState<string | null>(null);

  const [isFetchingSTTModels, setIsFetchingSTTModels] = useState(false);
  const [fetchedSTTModels, setFetchedSTTModels] = useState<string[] | null>(null);
  const [fetchSTTModelsStatus, setFetchSTTModelsStatus] = useState<string | null>(null);

  const compatibilityFingerprint = JSON.stringify({
    provider,
    baseUrl: localConfig.baseUrl.trim(),
    llmModel: localConfig.llmModel.trim(),
    transcriptionMode: localConfig.transcriptionMode,
    sttUrl: localConfig.sttUrl.trim(),
    sttModel: localConfig.sttModel.trim(),
    engineType: localConfig.engineType,
    sttEngine: localConfig.sttEngine,
    apiKey: localConfig.apiKey?.trim(),
    sttApiKey: localConfig.sttApiKey?.trim()
  });

  const handleFetchModels = async () => {
    setIsFetchingModels(true);
    setFetchModelsStatus('Checking the language-model endpoint…');
    setFetchedModels(null);
    try {
      const models = await fetchLocalModels(localConfig.baseUrl, localConfig.apiKey);
      if (models && models.length > 0) {
        setFetchedModels(models);
        setFetchModelsStatus(`Discovered ${models.length} language ${models.length === 1 ? 'model' : 'models'}.`);
      } else {
        setFetchedModels([]);
        setFetchModelsStatus('No language models were returned. Verify the endpoint and browser-access settings.');
      }
    } catch (err: any) {
      setFetchModelsStatus(`Discovery failed: ${err.message || 'Network error'}`);
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleFetchSTTModels = async () => {
    setIsFetchingSTTModels(true);
    setFetchSTTModelsStatus('Checking the speech endpoint…');
    setFetchedSTTModels(null);
    try {
      const models = await fetchLocalSTTModels(localConfig.sttUrl, localConfig.sttApiKey || localConfig.apiKey);
      if (models && models.length > 0) {
        setFetchedSTTModels(models);
        setFetchSTTModelsStatus(`Discovered ${models.length} speech ${models.length === 1 ? 'model' : 'models'}.`);
      } else {
        setFetchedSTTModels([]);
        setFetchSTTModelsStatus('No speech models were returned. Check the configured endpoint logs.');
      }
    } catch (err: any) {
      setFetchSTTModelsStatus(`Discovery failed: ${err.message || 'Network error'}`);
    } finally {
      setIsFetchingSTTModels(false);
    }
  };

  const handleEngineChange = (engine: LocalEngineType) => {
    let defaultUrl = localConfig.baseUrl;
    if (engine === 'vllm') defaultUrl = 'http://localhost:8000/v1';
    else if (engine === 'ollama') defaultUrl = 'http://localhost:11434';
    else if (engine === 'lmstudio') defaultUrl = 'http://localhost:1234/v1';
    else if (engine === 'custom') defaultUrl = 'http://localhost:8080/v1';

    setLocalConfig({
      ...localConfig,
      engineType: engine,
      baseUrl: defaultUrl
    });
    setFetchedModels(null);
    setFetchModelsStatus(null);
  };

  const handleSTTEngineChange = (sttEngine: STTEngineType) => {
    let defaultSttUrl = localConfig.sttUrl;
    let defaultSttModel = localConfig.sttModel;

    if (sttEngine === 'faster_whisper') {
      defaultSttUrl = 'http://localhost:1234/v1';
      defaultSttModel = 'whisper-large-v3-turbo';
    } else if (sttEngine === 'vllm_stt') {
      defaultSttUrl = 'http://localhost:8000/v1';
      defaultSttModel = 'whisper-large-v3-turbo';
    } else if (sttEngine === 'groq_stt') {
      defaultSttUrl = 'https://api.groq.com/openai/v1';
      defaultSttModel = 'whisper-large-v3-turbo';
    } else if (sttEngine === 'ollama_stt') {
      defaultSttUrl = 'http://localhost:11434';
      defaultSttModel = 'whisper';
    } else if (sttEngine === 'custom_stt') {
      defaultSttUrl = 'http://localhost:8080/v1';
    }

    setLocalConfig({
      ...localConfig,
      sttEngine,
      sttUrl: defaultSttUrl,
      sttModel: defaultSttModel
    });
    setFetchedSTTModels(null);
    setFetchSTTModelsStatus(null);
  };

  const handleRouteOutcomeChange = (outcome: RouteOutcome) => {
    setOpenExpertSection(null);
    if (outcome === 'gemini') {
      setProvider(ModelProvider.GEMINI);
      announceStatus('Processing route changed to Google Gemini cloud.');
      return;
    }

    setProvider(ModelProvider.LOCAL);
    setLocalConfig(current => ({
      ...current,
      transcriptionMode: outcome === 'hybrid'
        ? TranscriptionMode.HYBRID
        : TranscriptionMode.LOCAL_STT
    }));
    announceStatus(outcome === 'hybrid'
      ? 'Processing route changed to Gemini speech with your language model.'
      : 'Processing route changed to your configured speech and language-model endpoints.');
  };

  const [showSettings, setShowSettings] = useState(false);
  const [openExpertSection, setOpenExpertSection] = useState<ExpertSectionId | null>(null);

  // Sync settings to localStorage
  useEffect(() => {
    localStorage.setItem('model_provider', provider);
  }, [provider]);

  useEffect(() => {
    localStorage.setItem('local_config', JSON.stringify(localConfig));
  }, [localConfig]);

  const focusSettingsTarget = (targetId: string) => {
    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId)
        || document.getElementById('expert-processing-settings');
      target?.focus();
    });
  };

  useEffect(() => {
    if (!showSettings || !openExpertSection || !pendingSettingsFocusRef.current) return;
    const targetId = pendingSettingsFocusRef.current;
    pendingSettingsFocusRef.current = null;
    focusSettingsTarget(targetId);
  }, [showSettings, openExpertSection]);

  useEffect(() => {
    routeCheckControllerRef.current?.abort();
    routeCheckControllerRef.current = null;
    setRouteCheck({ status: 'idle', report: null });
    setRouteCheckFingerprint('');
  }, [compatibilityFingerprint]);

  useEffect(() => () => {
    requestVersionRef.current += 1;
    activeRequestControllerRef.current?.abort();
    routeCheckControllerRef.current?.abort();
  }, []);

  // Clean up object URL when file changes or unmounts
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setObjectUrl(null);
    }
  }, [file]);

  useEffect(() => {
    if (error) errorRegionRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (status === AppStatus.CANCELLED) document.getElementById('retry-canceled-button')?.focus();
  }, [status]);

  const handleFileSelect = (selectedFile: File) => {
    const validation = validateMediaFile(selectedFile);
    if (validation.valid === false) {
      setError({
        code: 'INVALID_FILE',
        stage: 'validation',
        title: 'This media file cannot be used',
        message: validation.message,
        suggestion: 'Choose another supported media file. Your route settings and speech hints are unchanged.',
        retryable: false,
        recovery: 'file'
      });
      setStatus(AppStatus.ERROR);
      return;
    }

    requestVersionRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
    setFile(selectedFile);
    setStatus(AppStatus.IDLE);
    setTranscription('');
    setGeneratedTranscription('');
    setTranscriptTitle('');
    setTranscriptNotes('');
    setCompletionMetadata(null);
    setPartialTranscription('');
    setPartialMetadata(null);
    setError(null);
    setUploadProgress(null);
    setProcessingStatus('');
    announceStatus(`Selected ${selectedFile.name}. Review the route and speech hints, then start transcription.`);
    window.requestAnimationFrame(() => document.getElementById('preparation-stage-title')?.focus());
  };

  const performRouteCheck = async (
    providerSnapshot: ModelProvider,
    configSnapshot: LocalConfig,
    fingerprint: string,
    signal: AbortSignal,
    resumeFromTranscription = false
  ) => {
    setRouteCheck({ status: 'checking', report: null });
    const report = await preflightTranscriptionRoute(providerSnapshot, configSnapshot, signal, resumeFromTranscription);
    if (!signal.aborted) {
      setRouteCheck({ status: 'complete', report });
      setRouteCheckFingerprint(fingerprint);
    }
    return report;
  };

  const handleCheckRoute = async () => {
    if (status === AppStatus.PROCESSING) return;
    routeCheckControllerRef.current?.abort();
    const controller = new AbortController();
    routeCheckControllerRef.current = controller;
    const fingerprint = scopedRouteFingerprint(compatibilityFingerprint, false);
    try {
      const report = await performRouteCheck(provider, { ...localConfig }, fingerprint, controller.signal);
      if (routeCheckControllerRef.current !== controller || controller.signal.aborted) return;
      window.requestAnimationFrame(() => document.getElementById('processing-route-status')?.focus());
    } catch (checkError) {
      if (isAbortError(checkError)) return;
      const issue = normalizeTranscriptionError(checkError, 'preflight');
      const report: CompatibilityReport = {
        status: 'blocked',
        summary: 'Route needs attention before transcription.',
        checkedAt: new Date().toISOString(),
        checks: [{ target: 'llm', label: 'Processing route', status: 'fail', detail: issue.message, error: issue }]
      };
      setRouteCheck({ status: 'complete', report });
      setRouteCheckFingerprint(fingerprint);
      window.requestAnimationFrame(() => document.getElementById('processing-route-status')?.focus());
    } finally {
      if (routeCheckControllerRef.current === controller) routeCheckControllerRef.current = null;
    }
  };

  const handleTranscribe = async (restartFullPipeline = false) => {
    if (!file || status === AppStatus.PROCESSING) return;

    const validation = validateMediaFile(file);
    if (validation.valid === false) {
      setError({
        code: 'INVALID_FILE',
        stage: 'validation',
        title: 'This media file cannot be transcribed',
        message: validation.message,
        suggestion: 'Choose another supported media file. Your settings and speech hints will remain available.',
        retryable: false,
        recovery: 'file'
      });
      setStatus(AppStatus.ERROR);
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    activeRequestControllerRef.current?.abort();
    routeCheckControllerRef.current?.abort();
    const controller = new AbortController();
    activeRequestControllerRef.current = controller;
    const selectedFile = file;
    const providerSnapshot = provider;
    const configSnapshot = { ...localConfig };
    const termsSnapshot = [...termsList];
    const processingSnapshot: TranscriptionCompletionMetadata['processing'] = {
      provider: providerSnapshot,
      mode: providerSnapshot === ModelProvider.GEMINI
        ? ModelProvider.GEMINI
        : configSnapshot.transcriptionMode,
      routeTitle: processingRoute.title,
      routeDetail: processingRoute.detail,
      routeBadge: processingRoute.badge,
      llm: providerSnapshot === ModelProvider.GEMINI
        ? { engine: 'Google Gemini', model: GEMINI_MODEL }
        : { engine: selectedEngineName, model: configSnapshot.llmModel },
      stt: providerSnapshot === ModelProvider.GEMINI
        ? null
        : configSnapshot.transcriptionMode === TranscriptionMode.HYBRID
          ? { engine: 'Google Gemini', model: GEMINI_MODEL }
          : { engine: selectedSTTEngineName, model: configSnapshot.sttModel },
      configuredLanguage: providerSnapshot === ModelProvider.LOCAL
        && configSnapshot.transcriptionMode === TranscriptionMode.LOCAL_STT
        ? configSnapshot.sttLanguage || 'auto'
        : 'auto'
    };
    const attemptMetadata: TranscriptionCompletionMetadata = {
      source: {
        fileName: selectedFile.name,
        mimeType: selectedFile.type || 'application/octet-stream',
        sizeBytes: selectedFile.size,
        lastModified: selectedFile.lastModified
      },
      completedAt: new Date().toISOString(),
      processing: processingSnapshot,
      termsCount: termsSnapshot.length
    };

    setStatus(AppStatus.PROCESSING);
    setUploadProgress(null);
    setProcessingStatus('Testing the processing route…');
    setError(null);
    window.requestAnimationFrame(() => processingRegionRef.current?.focus());

    try {
      const resumeFromRecoveredTranscript = Boolean(partialTranscription && !restartFullPipeline);
      const desiredRouteFingerprint = scopedRouteFingerprint(
        compatibilityFingerprint,
        resumeFromRecoveredTranscript
      );
      const cachedCheckIsFresh = routeCheckFingerprint === desiredRouteFingerprint
        && routeCheck.report
        && Date.now() - new Date(routeCheck.report.checkedAt).getTime() < 30_000;
      const compatibility = cachedCheckIsFresh
        ? routeCheck.report!
        : await performRouteCheck(
            providerSnapshot,
            configSnapshot,
            desiredRouteFingerprint,
            controller.signal,
            resumeFromRecoveredTranscript
          );

      if (requestVersionRef.current !== requestVersion || controller.signal.aborted) return;
      if (compatibility.status === 'blocked') {
        const firstFailure = compatibility.checks.find(check => check.status === 'fail');
        setError(firstFailure?.error ? { ...firstFailure.error, target: firstFailure.target } : {
          code: 'INCOMPATIBLE_RESPONSE',
          stage: 'preflight',
          title: 'Processing route needs attention',
          message: firstFailure?.detail || compatibility.summary,
          suggestion: 'Open expert settings, test the route, then retry.',
          retryable: false,
          recovery: 'settings'
        });
        setStatus(AppStatus.ERROR);
        return;
      }

      setProcessingStatus(compatibility.status === 'warning'
        ? 'Route reached. Verifying speech compatibility with this media file…'
        : 'Route ready. Preparing the media file…');

      const result = await transcribeAudio({
        file: selectedFile,
        provider: providerSnapshot,
        localConfig: configSnapshot,
        customTerms: termsSnapshot,
        signal: controller.signal,
        resumeTranscript: restartFullPipeline ? undefined : partialTranscription || undefined
      }, {
        onProgress: (percent) => {
          if (requestVersionRef.current !== requestVersion) return;
          setUploadProgress(percent);
          if (percent === 100) {
            setProcessingStatus('Media sent. Waiting for speech recognition…');
          } else {
            setProcessingStatus(`Sending media: ${percent}%`);
          }
        },
        onStatusUpdate: (statusMessage) => {
          if (requestVersionRef.current !== requestVersion) return;
          setProcessingStatus(statusMessage);
        },
        onStageResult: (stage, text) => {
          if (requestVersionRef.current !== requestVersion || stage !== 'transcription' || !text.trim()) return;
          setPartialTranscription(text);
          setPartialMetadata({ ...attemptMetadata, completedAt: new Date().toISOString() });
        }
      });

      if (requestVersionRef.current !== requestVersion) return;

      setTranscription(result);
      setGeneratedTranscription(result);
      setTranscriptTitle(getDefaultTranscriptTitle(selectedFile.name));
      setTranscriptNotes('');
      setCompletionMetadata({ ...attemptMetadata, completedAt: new Date().toISOString() });
      setPartialTranscription('');
      setPartialMetadata(null);
      setStatus(AppStatus.COMPLETED);
    } catch (err: unknown) {
      if (requestVersionRef.current !== requestVersion) return;
      if (isAbortError(err) || controller.signal.aborted) return;
      setError(normalizeTranscriptionError(err));
      setStatus(AppStatus.ERROR);
    } finally {
      if (requestVersionRef.current === requestVersion && activeRequestControllerRef.current === controller) {
        activeRequestControllerRef.current = null;
        setUploadProgress(null);
        setProcessingStatus('');
      }
    }
  };

  const handleCancel = () => {
    if (status !== AppStatus.PROCESSING) return;
    requestVersionRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
    setUploadProgress(null);
    setProcessingStatus('');
    if (routeCheck.status === 'checking') {
      setRouteCheck({ status: 'idle', report: null });
      setRouteCheckFingerprint('');
    }
    setError(null);
    setStatus(AppStatus.CANCELLED);
    announceStatus('Transcription canceled. Your file, route settings, speech hints, and recovered work are preserved.');
  };

  const handleUseRecoveredTranscript = () => {
    if (!partialTranscription || !partialMetadata) return;
    setTranscription(partialTranscription);
    setGeneratedTranscription(partialTranscription);
    setTranscriptTitle(getDefaultTranscriptTitle(partialMetadata.source.fileName));
    setTranscriptNotes('');
    setCompletionMetadata(partialMetadata);
    setPartialTranscription('');
    setPartialMetadata(null);
    setError(null);
    setStatus(AppStatus.COMPLETED);
  };

  const handleReviewSettings = () => {
    const issueCopy = `${error?.title || ''} ${error?.message || ''}`.toLowerCase();
    const isSpeechIssue = error?.target === 'stt'
      || /speech|\bstt\b|whisper|groq|audio transcription/.test(issueCopy);
    const isModelIssue = error?.code === 'MODEL_NOT_FOUND';
    const targetSection: ExpertSectionId = provider === ModelProvider.GEMINI
      ? 'speech'
      : isModelIssue ? 'models' : 'connections';
    const targetId = provider === ModelProvider.GEMINI
      ? 'expert-speech-panel'
      : error?.code === 'AUTH_FAILED'
        ? isSpeechIssue ? 'stt-api-key-input' : 'llm-api-key-input'
        : isSpeechIssue
          ? isModelIssue ? 'stt-model-identifier' : 'stt-url-input'
          : isModelIssue ? 'llm-model-identifier' : 'llm-url-input';

    pendingSettingsFocusRef.current = targetId;
    if (showSettings && openExpertSection === targetSection) {
      pendingSettingsFocusRef.current = null;
      focusSettingsTarget(targetId);
    }
    setOpenExpertSection(targetSection);
    setShowSettings(true);
  };

  const handleReset = () => {
    requestVersionRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
    setFile(null);
    setTranscription('');
    setGeneratedTranscription('');
    setTranscriptTitle('');
    setTranscriptNotes('');
    setCompletionMetadata(null);
    setPartialTranscription('');
    setPartialMetadata(null);
    setStatus(AppStatus.IDLE);
    setError(null);
    setUploadProgress(null);
    setProcessingStatus('');
    announceStatus('Current file cleared. Choose another audio or video file.');
    window.requestAnimationFrame(() => document.getElementById('media-file-picker-trigger')?.focus());
  };

  const engineNames: Record<string, string> = {
    vllm: 'vLLM',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
    custom: 'Custom endpoint'
  };

  const sttEngineNames: Record<string, string> = {
    faster_whisper: 'Faster-Whisper',
    vllm_stt: 'vLLM Audio',
    groq_stt: 'Groq speech',
    ollama_stt: 'Ollama Audio',
    custom_stt: 'Custom speech'
  };

  const selectedEngineName = engineNames[localConfig.engineType || 'vllm'] || localConfig.engineType;
  const selectedSTTEngineName = sttEngineNames[localConfig.sttEngine || 'faster_whisper'] || localConfig.sttEngine;
  const isLoopbackEndpoint = (endpoint: string) => {
    try {
      const hostname = new URL(endpoint).hostname;
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch {
      return false;
    }
  };

  const endpointLabel = (endpoint: string) => {
    try {
      const url = new URL(endpoint);
      return `${url.hostname}${url.port ? `:${url.port}` : ''}`;
    } catch {
      return 'configured endpoint';
    }
  };

  const llmUsesLoopback = isLoopbackEndpoint(localConfig.baseUrl);
  const sttUsesLoopback = localConfig.sttEngine !== 'groq_stt' && isLoopbackEndpoint(localConfig.sttUrl);
  const llmEndpointLabel = endpointLabel(localConfig.baseUrl);
  const sttEndpointLabel = endpointLabel(localConfig.sttUrl);
  const activeRouteOutcome: RouteOutcome = provider === ModelProvider.GEMINI
    ? 'gemini'
    : localConfig.transcriptionMode === TranscriptionMode.HYBRID
      ? 'hybrid'
      : 'configured';

  const configuredRouteLocation = sttUsesLoopback && llmUsesLoopback
    ? {
        title: 'Localhost speech → localhost refinement',
        badge: 'Localhost endpoints',
        location: 'Media and transcript text are sent to the configured localhost endpoints. Browser-blocked requests may be relayed by the app server.'
      }
    : sttUsesLoopback
      ? {
          title: 'Localhost speech → configured refinement',
          badge: 'Localhost + custom endpoint',
          location: 'Media is sent to the configured localhost speech endpoint; the raw transcript goes to the configured refinement endpoint. Browser-blocked requests may be relayed by the app server.'
        }
      : llmUsesLoopback
        ? {
            title: 'Configured speech → localhost refinement',
            badge: 'Custom endpoint + localhost',
            location: 'Media is sent to the configured speech endpoint; the raw transcript goes to the configured localhost refinement endpoint. Browser-blocked requests may be relayed by the app server.'
          }
        : {
            title: 'Configured speech → configured refinement',
            badge: 'Custom endpoints',
            location: 'Media and transcript text are sent to the configured processing endpoints. Browser-blocked requests may be relayed by the app server.'
          };

  const processingRoute = provider === ModelProvider.GEMINI
    ? {
        title: 'Google Gemini transcription',
        detail: `Google Gemini / ${GEMINI_MODEL}`,
        badge: 'Cloud',
        location: 'Media is uploaded to Google Gemini through the app server for transcription.'
      }
    : localConfig.transcriptionMode === TranscriptionMode.HYBRID
      ? {
          title: llmUsesLoopback ? 'Google Gemini speech → localhost refinement' : 'Google Gemini speech → configured refinement',
          detail: `Google Gemini / ${GEMINI_MODEL} → ${selectedEngineName} / ${localConfig.llmModel} at ${llmEndpointLabel}`,
          badge: llmUsesLoopback ? 'Cloud + localhost' : 'Cloud + custom endpoint',
          location: llmUsesLoopback
            ? 'Media is uploaded to Google Gemini through the app server; the raw transcript goes to the configured localhost refinement endpoint.'
            : 'Media is uploaded to Google Gemini through the app server; the raw transcript goes to the configured refinement endpoint.'
        }
      : {
          ...configuredRouteLocation,
          detail: `${selectedSTTEngineName} / ${localConfig.sttModel} at ${sttEndpointLabel} → ${selectedEngineName} / ${localConfig.llmModel} at ${llmEndpointLabel}`
        };

  const progressBucket = uploadProgress !== null && uploadProgress < 100
    ? Math.max(0, Math.floor(uploadProgress / 10) * 10)
    : null;
  const accessibleProcessingStatus = progressBucket !== null
    ? `Sending ${file?.name || 'media file'}: ${progressBucket}% complete.`
    : processingStatus || 'Processing media and creating the transcript.';
  const routeStatusPresentation = routeCheck.status === 'checking'
    ? { label: 'Testing endpoints and models…', tone: 'text-indigo-200', dot: 'bg-indigo-300' }
    : routeCheck.report?.status === 'compatible'
      ? { label: routeCheck.report.summary, tone: 'text-emerald-200', dot: 'bg-emerald-300' }
      : routeCheck.report?.status === 'warning'
        ? { label: routeCheck.report.summary, tone: 'text-amber-200', dot: 'bg-amber-300' }
        : routeCheck.report?.status === 'blocked'
          ? { label: routeCheck.report.summary, tone: 'text-red-200', dot: 'bg-red-300' }
          : { label: 'Route not tested', tone: 'text-slate-400', dot: 'bg-slate-500' };

  const emptyTranscriptState = !file
    ? {
        title: 'Transcript will appear here',
        body: 'Choose a media file to begin.'
      }
    : status === AppStatus.PROCESSING
      ? {
          title: 'Transcription in progress',
          body: 'The transcript workspace will open when processing completes.'
        }
      : status === AppStatus.ERROR
        ? {
            title: 'Transcription paused',
            body: 'Use the recovery actions above to continue without losing your work.'
          }
        : status === AppStatus.CANCELLED
          ? {
              title: 'Transcription canceled',
              body: 'Retry when ready; your selected media and saved work remain available.'
            }
          : {
              title: 'Ready to transcribe',
              body: 'Review the processing route, then start transcription.'
            };
  const hasCompletedTranscript = status === AppStatus.COMPLETED && completionMetadata !== null;
  const fileIsVideo = Boolean(file && (
    file.type.startsWith('video/')
    || (!file.type && (file.name.toLowerCase().endsWith('.mp4') || file.name.toLowerCase().endsWith('.mov')))
  ));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        <span key={liveAnnouncement.id}>{liveAnnouncement.message}</span>
      </div>
      
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <SignalToTextMark className="absolute left-1/2 top-[-2rem] h-72 w-[72rem] max-w-none -translate-x-1/2 opacity-[0.055]" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        
        <header className="mb-8 border-b border-slate-800/90 pb-7 lg:mb-10 lg:pb-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
            <div className="min-w-0">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-indigo-400/30 bg-indigo-500/10" aria-hidden="true">
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-1 rounded-full bg-indigo-300/70" />
                    <span className="h-6 w-1 rounded-full bg-indigo-300" />
                    <span className="h-9 w-1 rounded-full bg-indigo-200" />
                    <span className="h-5 w-1 rounded-full bg-indigo-300" />
                    <span className="h-7 w-1 rounded-full bg-indigo-300/80" />
                  </span>
                </span>
                <h1 className="min-w-0 font-editorial text-4xl font-semibold leading-[0.98] tracking-[-0.03em] text-slate-50 [overflow-wrap:anywhere] sm:text-5xl">
                  Media Scribe
                </h1>
              </div>
              <p className="mt-4 max-w-[65ch] text-base leading-7 text-slate-300">
                Turn audio and video into editable, export-ready transcripts. Use Google Gemini or your own speech and language-model endpoints; the processing route below shows where each stage runs.
              </p>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/55 px-4 py-3">
              <SignalToTextMark className="h-16 w-full" />
              <div className="flex items-start justify-between gap-4 border-t border-slate-800 pt-2 font-mono text-xs font-medium text-slate-400">
                <span className="min-w-0 text-left [overflow-wrap:anywhere]">Media signal</span>
                <span className="min-w-0 text-right [overflow-wrap:anywhere]">Editable transcript</span>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main>
          <ol className="list-none space-y-8 sm:space-y-10" role="list">
            <li>
              <section aria-labelledby="media-stage-title">
                <WorkflowStageHeader
                  number={1}
                  id="media-stage-title"
                  title="Choose media"
                  description="Select one audio or video file and confirm the source before processing."
                  state={file ? 'complete' : 'current'}
                />
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 shadow-xl shadow-slate-950/25 backdrop-blur-md sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 id="media-upload-title" className="text-lg font-semibold text-slate-50">Media file</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Choose one audio or video file to transcribe.</p>
                </div>
                {file && status !== AppStatus.PROCESSING && status !== AppStatus.COMPLETED && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="min-h-11 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 motion-reduce:transition-none"
                  >
                    Remove file
                  </button>
                )}
              </div>

              {!file ? (
                <FileUploader onFileSelect={handleFileSelect} />
              ) : (
                <div className="min-w-0 animate-fadeIn">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/20">
                      {fileIsVideo ? (
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6.5h11a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2v-7a2 2 0 012-2zM17 10l5-2.5v9L17 14" />
                        </svg>
                      ) : (
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 12h2m2-5v10m4-13v16m4-12v8m4-6v4" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="max-w-full font-medium text-slate-100 [overflow-wrap:anywhere]">{file.name}</p>
                      <p className="mt-0.5 text-sm text-slate-400">{formatFileSize(file.size)}</p>
                    </div>
                  </div>

                  {objectUrl && (
                    fileIsVideo ? (
                      <video
                        controls
                        src={objectUrl}
                        aria-label={`Video preview for ${file.name}`}
                        className="mt-4 max-h-56 w-full min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950"
                      />
                    ) : (
                      <audio
                        controls
                        src={objectUrl}
                        aria-label={`Audio preview for ${file.name}`}
                        className="mt-4 h-11 w-full min-w-0 max-w-full rounded-lg"
                      />
                    )
                  )}
                </div>
              )}

            </div>
              </section>
            </li>

            <li>
              <section aria-labelledby="preparation-stage-title">
                <WorkflowStageHeader
                  number={2}
                  id="preparation-stage-title"
                  title="Prepare transcription"
                  description="Confirm the processing route, add optional speech hints, then start."
                  focusable
                  state={hasCompletedTranscript ? 'complete' : file ? 'current' : 'upcoming'}
                />

                <div className={`grid items-start gap-4 ${hasCompletedTranscript ? '' : 'xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]'}`}>
                  <article
                    className={`relative overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/60 p-4 shadow-lg shadow-slate-950/20 transition-colors duration-200 motion-reduce:transition-none sm:p-5 ${hasCompletedTranscript ? 'xl:col-span-2' : ''}`}
                    aria-labelledby="processing-route-title"
                  >
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-300 ring-1 ring-inset ring-indigo-500/20">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 7h10m0 0-3-3m3 3-3 3m9 7H10m0 0 3 3m-3-3 3-3" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h3 id="processing-route-title" className="text-lg font-semibold text-slate-50">Processing route</h3>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 text-base font-semibold text-slate-100 [overflow-wrap:anywhere]">{processingRoute.title}</p>
                    <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-600">
                      {processingRoute.badge}
                    </span>
                  </div>
                  <p className="mt-1 min-w-0 text-sm leading-6 text-slate-400 [overflow-wrap:anywhere]">{processingRoute.detail}</p>
                  <p
                    id="processing-route-status"
                    tabIndex={-1}
                    className={`mt-3 flex min-w-0 items-start gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${routeStatusPresentation.tone}`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${routeStatusPresentation.dot}`} aria-hidden="true" />
                    <span className="min-w-0 text-xs font-medium leading-5 [overflow-wrap:anywhere]">{routeStatusPresentation.label}</span>
                  </p>
                </div>
              </div>
              <div className="w-full md:w-auto md:max-w-xs md:shrink-0">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:justify-end">
                  <button
                    type="button"
                    onClick={handleCheckRoute}
                    disabled={status === AppStatus.PROCESSING || routeCheck.status === 'checking'}
                    aria-busy={routeCheck.status === 'checking' || undefined}
                    aria-describedby="processing-route-status route-test-guidance"
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 ring-1 ring-inset ring-slate-600 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none md:w-auto"
                  >
                    <svg className={`h-4 w-4 ${routeCheck.status === 'checking' ? 'animate-spin motion-reduce:animate-none' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8 8 0 104.582 9M20 20v-5h-.581" />
                    </svg>
                    {routeCheck.status === 'checking' ? 'Testing route…' : 'Test route'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSettings(!showSettings)}
                    disabled={status === AppStatus.PROCESSING}
                    aria-expanded={showSettings}
                    aria-controls="expert-processing-settings"
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 ring-1 ring-inset ring-slate-700 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none md:w-auto"
                  >
                    {showSettings ? 'Hide expert settings' : 'Expert settings'}
                    <svg className={`h-4 w-4 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                <p id="route-test-guidance" className="mt-2 text-xs leading-5 text-slate-400 md:text-right">
                  <span className="font-semibold text-slate-300">Optional.</span> Recommended before large uploads or whenever you change the route.
                </p>
              </div>
            </div>

            {routeCheck.report && (
              <details className="mt-4 rounded-xl bg-slate-950/40 px-3 py-2 text-xs text-slate-300 ring-1 ring-inset ring-slate-800">
                <summary className="flex min-h-11 cursor-pointer items-center py-2 font-medium text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
                  Route test details
                </summary>
                <ul className="mt-1 space-y-2 pb-1">
                  {routeCheck.report.checks.map(check => (
                    <li key={check.target} className="flex min-w-0 items-start gap-2">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${check.status === 'pass' ? 'bg-emerald-300' : check.status === 'warning' ? 'bg-amber-300' : 'bg-red-300'}`} aria-hidden="true" />
                      <span className="min-w-0 [overflow-wrap:anywhere]"><strong className="text-slate-200">{check.label} — {check.status}.</strong> {check.detail}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
                  </article>

                  {!hasCompletedTranscript && (
                    <SpeechHints
                      inputRef={termsInputRef}
                      termsText={termsText}
                      termsList={termsList}
                      termsFileName={termsFileName}
                      termsError={termsError}
                      isDragging={isDraggingTerms}
                      disabled={status === AppStatus.PROCESSING}
                      onClear={handleClearTerms}
                      onFileSelect={handleTermsFileSelect}
                      onFileDrop={handleTermsFileDrop}
                      onDragStateChange={setIsDraggingTerms}
                      onTextChange={handleTermsTextChange}
                    />
                  )}
                </div>

            <ExpertSettings
              hidden={!showSettings}
              disabled={status === AppStatus.PROCESSING}
              provider={provider}
              localConfig={localConfig}
              activeRouteOutcome={activeRouteOutcome}
              openSection={openExpertSection}
              selectedEngineName={selectedEngineName}
              selectedSTTEngineName={selectedSTTEngineName}
              llmUsesLoopback={llmUsesLoopback}
              sttUsesLoopback={sttUsesLoopback}
              isFetchingModels={isFetchingModels}
              fetchedModels={fetchedModels}
              fetchModelsStatus={fetchModelsStatus}
              isFetchingSTTModels={isFetchingSTTModels}
              fetchedSTTModels={fetchedSTTModels}
              fetchSTTModelsStatus={fetchSTTModelsStatus}
              onOpenSectionChange={setOpenExpertSection}
              onRouteOutcomeChange={handleRouteOutcomeChange}
              onConfigChange={setLocalConfig}
              onEngineChange={handleEngineChange}
              onSTTEngineChange={handleSTTEngineChange}
              onFetchModels={handleFetchModels}
              onFetchSTTModels={handleFetchSTTModels}
            />

                <div className="mt-5 flex flex-col gap-4 border-t border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div id="processing-location-summary" className="flex min-w-0 max-w-2xl items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300 ring-1 ring-inset ring-indigo-500/25">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 21s6-5.4 6-11a6 6 0 10-12 0c0 5.6 6 11 6 11z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-300">Processing location</span>
                      <span className="mt-0.5 block text-sm leading-6 text-slate-400 [overflow-wrap:anywhere]">{processingRoute.location}</span>
                    </span>
                  </div>

                  {file && status === AppStatus.IDLE && (
                    <Button
                      id="start-transcription-button"
                      type="button"
                      onClick={() => handleTranscribe()}
                      aria-describedby="processing-location-summary processing-route-status"
                      className="w-full shrink-0 px-6 py-3 text-base sm:w-auto"
                    >
                      Start transcription
                    </Button>
                  )}
                </div>

                {status === AppStatus.PROCESSING && (
                  <div
                    ref={processingRegionRef}
                    tabIndex={-1}
                    className="mt-5 flex flex-col items-center space-y-3 rounded-xl border border-indigo-400/30 bg-indigo-900/10 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                    role="group"
                    aria-label="Transcription in progress"
                  >
                    <p className="max-w-lg text-center text-xs font-medium text-indigo-200">
                      Processing via {processingRoute.title} · {processingRoute.badge}
                    </p>
                    <div
                      className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-700"
                      role="progressbar"
                      aria-label="Transcription progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={uploadProgress ?? undefined}
                      aria-valuetext={accessibleProcessingStatus}
                    >
                      {uploadProgress !== null ? (
                        <div
                          className="h-full bg-indigo-400 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      ) : (
                        <div className="h-full w-1/3 bg-indigo-400 animate-progress motion-reduce:animate-none" />
                      )}
                    </div>
                    <p className="min-h-5 max-w-lg break-words text-center text-sm leading-5 text-indigo-100" aria-hidden="true">
                      {processingStatus || 'Processing media and creating the transcript…'}
                    </p>
                    <p id="processing-live-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                      {accessibleProcessingStatus}
                    </p>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="min-h-11 rounded-lg px-4 py-2 text-sm font-semibold text-indigo-100 ring-1 ring-inset ring-indigo-300/50 transition-colors hover:bg-indigo-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 motion-reduce:transition-none"
                    >
                      Cancel transcription
                    </button>
                  </div>
                )}

                {error && (
                  <div
                    ref={errorRegionRef}
                    tabIndex={-1}
                    className="mt-5 flex items-start gap-3 rounded-xl border border-red-400/40 bg-red-900/20 p-4 text-sm text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                    role="alert"
                    aria-atomic="true"
                  >
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="min-w-0 flex-1 space-y-2 [overflow-wrap:anywhere]">
                      <h3 className="font-semibold text-red-50">{error.title}</h3>
                      <p>{error.message}</p>
                      <p className="text-red-100/90">{error.suggestion}</p>
                      {partialTranscription && (
                        <p className="rounded-lg bg-slate-950/50 px-3 py-2 text-slate-200 ring-1 ring-inset ring-slate-700">
                          A raw transcript was saved. Retry refinement to continue without sending the media through speech recognition again.
                        </p>
                      )}
                      {error.technicalDetail && (
                        <details className="text-xs text-red-100/80">
                          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300">Technical detail</summary>
                          <p className="mt-1 font-mono [overflow-wrap:anywhere]">{error.technicalDetail}</p>
                        </details>
                      )}
                      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
                        {error.recovery !== 'file' && (
                          <Button type="button" onClick={() => handleTranscribe()} className="w-full sm:w-auto">
                            {partialTranscription ? 'Retry refinement' : 'Retry transcription'}
                          </Button>
                        )}
                        {error.recovery === 'settings' && (
                          <Button type="button" variant="secondary" onClick={handleReviewSettings} className="w-full sm:w-auto">
                            Review expert settings
                          </Button>
                        )}
                        {partialTranscription && (
                          <>
                            <Button type="button" variant="secondary" onClick={handleUseRecoveredTranscript} className="w-full sm:w-auto">
                              Open raw transcript
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => handleTranscribe(true)} className="w-full sm:w-auto">
                              Restart from media
                            </Button>
                          </>
                        )}
                        {error.recovery === 'file' && (
                          <Button type="button" variant="secondary" onClick={handleReset} className="w-full sm:w-auto">
                            Choose another file
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {status === AppStatus.CANCELLED && (
                  <div className="mt-5 rounded-xl border border-slate-600 bg-slate-800/50 p-4" aria-labelledby="canceled-title">
                    <h3 id="canceled-title" className="font-semibold text-slate-100">Transcription canceled</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-300">
                      Your media file, route settings, speech hints, and any saved raw transcript are unchanged.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button id="retry-canceled-button" type="button" onClick={() => handleTranscribe()} className="w-full sm:w-auto">
                        {partialTranscription ? 'Retry refinement' : 'Retry transcription'}
                      </Button>
                      {partialTranscription && (
                        <Button type="button" variant="secondary" onClick={handleUseRecoveredTranscript} className="w-full sm:w-auto">
                          Open raw transcript
                        </Button>
                      )}
                      <Button type="button" variant="ghost" onClick={handleReset} className="w-full sm:w-auto">Choose another file</Button>
                    </div>
                  </div>
                )}
              </section>
            </li>

            <li>
              <section aria-labelledby="transcript-stage-title">
                <WorkflowStageHeader
                  number={3}
                  id="transcript-stage-title"
                  title="Transcript"
                  description="Review, edit, and export the completed transcript here."
                  state={hasCompletedTranscript ? 'current' : 'upcoming'}
                />

                {hasCompletedTranscript ? (
                  <TranscriptionDisplay
                    text={transcription}
                    originalText={generatedTranscription}
                    title={transcriptTitle}
                    notes={transcriptNotes}
                    metadata={completionMetadata!}
                    onTextChange={setTranscription}
                    onTitleChange={setTranscriptTitle}
                    onNotesChange={setTranscriptNotes}
                    onTranscribeAnother={handleReset}
                    headingLevel="h3"
                  />
                ) : (
                  <div className="flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-5 text-slate-300 sm:min-h-60 sm:p-8">
                    <SignalToTextMark className="mb-3 h-14 w-56 max-w-full opacity-55" />
                    <h3 className="font-editorial text-xl font-semibold leading-tight text-slate-100">{emptyTranscriptState.title}</h3>
                    <p className="mt-1 max-w-sm text-center text-sm leading-6 text-slate-400">{emptyTranscriptState.body}</p>
                  </div>
                )}
              </section>
            </li>
          </ol>
        </main>
      </div>

      <style>{`
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 95%; }
        }
        .animate-progress {
          animation: progress 8s ease-out forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            scroll-behavior: auto !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
          }
          .animate-progress,
          .animate-pulse,
          .animate-spin,
          .animate-fadeIn {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
};

export default App;
