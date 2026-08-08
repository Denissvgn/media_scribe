import React from 'react';
import { GEMINI_MODEL } from '../constants';
import {
  LocalConfig,
  LocalEngineType,
  ModelProvider,
  STTEngineType,
  TranscriptionMode
} from '../types';

export type RouteOutcome = 'gemini' | 'hybrid' | 'configured';
export type ExpertSectionId = 'language' | 'speech' | 'connections' | 'models' | 'launch';

const LANGUAGE_MODEL_PRESET_GROUPS = [
  { label: 'Gemma 4', options: ['gemma4', 'gemma-4-9b-it', 'google/gemma-4-27b-it'] },
  { label: 'GPT-OSS', options: ['gpt-oss', 'gpt-oss-13b', 'openai/gpt-oss-20b'] },
  { label: 'Open models', options: ['gemma2', 'llama3.3', 'qwen2.5', 'mistral'] }
] as const;

const SPEECH_MODEL_PRESET_GROUPS = [
  {
    label: 'Low latency',
    options: ['whisper-large-v3-turbo', 'distil-whisper-large-v3', 'SenseVoiceSmall', 'moonshine/base']
  },
  { label: 'High accuracy', options: ['whisper-large-v3', 'whisper-medium', 'whisper-1'] },
  { label: 'Audio model', options: ['Qwen/Qwen2-Audio-7B-Instruct'] }
] as const;

const LANGUAGE_MODEL_PRESETS: readonly string[] = LANGUAGE_MODEL_PRESET_GROUPS.flatMap(group => [...group.options]);
const SPEECH_MODEL_PRESETS: readonly string[] = SPEECH_MODEL_PRESET_GROUPS.flatMap(group => [...group.options]);

const LANGUAGE_ENGINES: Array<{ id: LocalEngineType; name: string; description: string }> = [
  { id: 'vllm', name: 'vLLM', description: 'OpenAI-compatible · default port 8000' },
  { id: 'ollama', name: 'Ollama', description: 'Native API · default port 11434' },
  { id: 'lmstudio', name: 'LM Studio', description: 'OpenAI-compatible · default port 1234' },
  { id: 'custom', name: 'Custom endpoint', description: 'OpenAI-compatible API' }
];

const SPEECH_ENGINES: Array<{ id: STTEngineType; name: string; description: string }> = [
  { id: 'faster_whisper', name: 'Faster-Whisper', description: 'High-speed speech recognition · port 1234' },
  { id: 'vllm_stt', name: 'vLLM Audio', description: 'vLLM speech endpoint · port 8000' },
  { id: 'groq_stt', name: 'Groq speech', description: 'Low-latency cloud speech recognition' },
  { id: 'ollama_stt', name: 'Ollama Audio', description: 'Ollama speech endpoint · port 11434' },
  { id: 'custom_stt', name: 'Custom endpoint', description: 'OpenAI-compatible speech API' }
];

const SPOKEN_LANGUAGES = [
  ['auto', 'Automatic'],
  ['en', 'English (en)'],
  ['es', 'Spanish (es)'],
  ['fr', 'French (fr)'],
  ['de', 'German (de)'],
  ['zh', 'Chinese (zh)'],
  ['ja', 'Japanese (ja)'],
  ['ru', 'Russian (ru)'],
  ['pt', 'Portuguese (pt)'],
  ['it', 'Italian (it)']
] as const;

const inputClassName = 'min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-100 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 sm:text-sm';
const monoInputClassName = `${inputClassName} font-mono`;

interface DisclosureProps {
  id: ExpertSectionId;
  title: string;
  summary: string;
  open: boolean;
  onToggle: (id: ExpertSectionId) => void;
  children: React.ReactNode;
}

const Disclosure: React.FC<DisclosureProps> = ({ id, title, summary, open, onToggle, children }) => (
  <section className="border-t border-slate-800 first:border-t-0">
    <h3>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={`expert-${id}-panel`}
        className="flex min-h-16 w-full min-w-0 items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300 motion-reduce:transition-none sm:px-5"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-100">{title}</span>
          <span className="mt-0.5 block min-w-0 text-xs leading-5 text-slate-400 [overflow-wrap:anywhere]">{summary}</span>
        </span>
        <svg
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </h3>
    <div
      id={`expert-${id}-panel`}
      hidden={!open}
      tabIndex={-1}
      className="border-t border-slate-800 bg-slate-950/45 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300 sm:p-5"
    >
      {children}
    </div>
  </section>
);

interface ExpertSettingsProps {
  hidden: boolean;
  disabled: boolean;
  provider: ModelProvider;
  localConfig: LocalConfig;
  activeRouteOutcome: RouteOutcome;
  openSection: ExpertSectionId | null;
  selectedEngineName: string;
  selectedSTTEngineName: string;
  llmUsesLoopback: boolean;
  sttUsesLoopback: boolean;
  isFetchingModels: boolean;
  fetchedModels: string[] | null;
  fetchModelsStatus: string | null;
  isFetchingSTTModels: boolean;
  fetchedSTTModels: string[] | null;
  fetchSTTModelsStatus: string | null;
  onOpenSectionChange: (section: ExpertSectionId | null) => void;
  onRouteOutcomeChange: (outcome: RouteOutcome) => void;
  onConfigChange: (config: LocalConfig) => void;
  onEngineChange: (engine: LocalEngineType) => void;
  onSTTEngineChange: (engine: STTEngineType) => void;
  onFetchModels: () => void;
  onFetchSTTModels: () => void;
}

export const ExpertSettings: React.FC<ExpertSettingsProps> = ({
  hidden,
  disabled,
  provider,
  localConfig,
  activeRouteOutcome,
  openSection,
  selectedEngineName,
  selectedSTTEngineName,
  llmUsesLoopback,
  sttUsesLoopback,
  isFetchingModels,
  fetchedModels,
  fetchModelsStatus,
  isFetchingSTTModels,
  fetchedSTTModels,
  fetchSTTModelsStatus,
  onOpenSectionChange,
  onRouteOutcomeChange,
  onConfigChange,
  onEngineChange,
  onSTTEngineChange,
  onFetchModels,
  onFetchSTTModels
}) => {
  const localSpeechEnabled = provider === ModelProvider.LOCAL
    && localConfig.transcriptionMode === TranscriptionMode.LOCAL_STT;
  const selectedLanguagePreset = LANGUAGE_MODEL_PRESETS.includes(localConfig.llmModel)
    ? localConfig.llmModel
    : '';
  const selectedSpeechPreset = SPEECH_MODEL_PRESETS.includes(localConfig.sttModel)
    ? localConfig.sttModel
    : '';
  const configuredRouteBadge = llmUsesLoopback && sttUsesLoopback
    ? 'Localhost endpoints'
    : 'Configured endpoints';

  const toggleSection = (section: ExpertSectionId) => {
    onOpenSectionChange(openSection === section ? null : section);
  };

  const routeChoices: Array<{
    id: RouteOutcome;
    title: string;
    description: string;
    badge: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'gemini',
      title: 'Google Gemini',
      description: 'Google Gemini handles speech recognition and transcript refinement.',
      badge: 'Simplest',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16.5A4.5 4.5 0 018.5 12h.3A6 6 0 0120 15a4 4 0 01-4 4H8.5A4.5 4.5 0 014 16.5z" />
        </svg>
      )
    },
    {
      id: 'hybrid',
      title: 'Gemini speech + your model',
      description: 'Gemini creates the raw transcript; your language model refines it.',
      badge: 'Split route',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h7m0 0L8.5 4.5M11 7L8.5 9.5M20 17h-7m0 0l2.5-2.5M13 17l2.5 2.5" />
        </svg>
      )
    },
    {
      id: 'configured',
      title: 'Your speech + your model',
      description: 'Use your configured speech and language-model endpoints for both stages.',
      badge: configuredRouteBadge,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5h14v5H5zM5 14h14v5H5zM8 7.5h.01M8 16.5h.01" />
        </svg>
      )
    }
  ];

  return (
    <div
      id="expert-processing-settings"
      hidden={hidden}
      tabIndex={-1}
      className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 shadow-lg shadow-slate-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 animate-fadeIn sm:p-5"
    >
      <fieldset disabled={disabled} className="min-w-0 border-0 p-0 disabled:opacity-70">
        <legend className="text-base font-semibold text-slate-100">Expert settings</legend>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
          Choose the outcome first. Open a technical section only when you need to adjust it.
        </p>

        <div className="mt-4" role="group" aria-labelledby="route-outcome-heading">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p id="route-outcome-heading" className="text-sm font-semibold text-slate-200">How should this file be processed?</p>
            <p className="text-xs text-slate-400">The selected route is saved in this browser.</p>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {routeChoices.map(choice => {
              const selected = activeRouteOutcome === choice.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => onRouteOutcomeChange(choice.id)}
                  aria-pressed={selected}
                  className={`group min-h-36 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 motion-reduce:transition-none ${
                    selected
                      ? 'border-indigo-400 bg-indigo-500/15 text-white shadow-lg shadow-indigo-950/20'
                      : 'border-slate-700 bg-slate-950/55 text-slate-300 hover:border-slate-500 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className={selected ? 'text-indigo-300' : 'text-slate-400'}>{choice.icon}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                      selected
                        ? 'bg-indigo-400/15 text-indigo-200 ring-indigo-400/40'
                        : 'bg-slate-900 text-slate-400 ring-slate-700'
                    }`}>
                      {choice.badge}
                    </span>
                  </span>
                  <span className="mt-4 block text-sm font-semibold text-slate-100">{choice.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">{choice.description}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 max-w-[68ch] text-xs leading-5 text-slate-400">
            Configured endpoints are contacted directly when possible; the app server may relay browser-blocked requests.
          </p>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/55">
          {provider === ModelProvider.LOCAL && (
            <Disclosure
              id="language"
              title="Language model"
              summary={`${selectedEngineName} · ${localConfig.llmModel}`}
              open={openSection === 'language'}
              onToggle={toggleSection}
            >
              <p className="mb-3 text-sm leading-6 text-slate-400">
                Choose the server architecture used to refine the raw transcript.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {LANGUAGE_ENGINES.map(engine => {
                  const selected = (localConfig.engineType || 'vllm') === engine.id;
                  return (
                    <button
                      type="button"
                      key={engine.id}
                      onClick={() => onEngineChange(engine.id)}
                      aria-pressed={selected}
                      className={`min-h-20 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 motion-reduce:transition-none ${
                        selected
                          ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100'
                          : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:bg-slate-900'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                        {engine.name}
                        {selected && <span className="h-2 w-2 rounded-full bg-indigo-300" aria-hidden="true" />}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">{engine.description}</span>
                    </button>
                  );
                })}
              </div>
            </Disclosure>
          )}

          <Disclosure
            id="speech"
            title="Speech recognition"
            summary={localSpeechEnabled
              ? `${selectedSTTEngineName} · ${localConfig.sttModel} · ${localConfig.sttLanguage || 'auto'}`
              : `Google Gemini · ${GEMINI_MODEL}`}
            open={openSection === 'speech'}
            onToggle={toggleSection}
          >
            {localSpeechEnabled ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-3 text-sm leading-6 text-slate-400">
                    Choose the endpoint architecture that turns media into a raw transcript.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {SPEECH_ENGINES.map(engine => {
                      const selected = (localConfig.sttEngine || 'faster_whisper') === engine.id;
                      return (
                        <button
                          type="button"
                          key={engine.id}
                          onClick={() => onSTTEngineChange(engine.id)}
                          aria-pressed={selected}
                          className={`min-h-20 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 motion-reduce:transition-none ${
                            selected
                              ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100'
                              : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:bg-slate-900'
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                            {engine.name}
                            {selected && <span className="h-2 w-2 rounded-full bg-indigo-300" aria-hidden="true" />}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-slate-400">{engine.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="max-w-md">
                  <label htmlFor="stt-language-select" className="mb-1.5 block text-xs font-medium text-slate-300">
                    Spoken language
                  </label>
                  <select
                    id="stt-language-select"
                    value={localConfig.sttLanguage || 'auto'}
                    onChange={event => onConfigChange({ ...localConfig, sttLanguage: event.target.value })}
                    className={`${inputClassName} cursor-pointer`}
                  >
                    {SPOKEN_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm leading-6 text-slate-400">
                <p>
                  {provider === ModelProvider.GEMINI
                    ? 'Google Gemini handles both speech recognition and transcript refinement.'
                    : 'Media is uploaded to Google Gemini through the app server for speech recognition, then the raw transcript is sent to your language-model endpoint for refinement.'}
                </p>
                <dl className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-5">
                  <dt className="font-medium text-slate-300">Model</dt>
                  <dd className="font-mono text-indigo-300 [overflow-wrap:anywhere]">{GEMINI_MODEL}</dd>
                  <dt className="font-medium text-slate-300">Formats</dt>
                  <dd>Supported audio and video formats are uploaded through the Gemini Files API.</dd>
                  <dt className="font-medium text-slate-300">App upload limit</dt>
                  <dd>500 MiB per file.</dd>
                  <dt className="font-medium text-slate-300">Cleanup</dt>
                  <dd>Temporary server files are removed after each request; Gemini file deletion is attempted after processing.</dd>
                </dl>
              </div>
            )}
          </Disclosure>

          {provider === ModelProvider.LOCAL && (
            <Disclosure
              id="connections"
              title="Connections & credentials"
              summary={localSpeechEnabled ? 'Two endpoint URLs · two optional API keys' : 'Language-model endpoint · optional API key'}
              open={openSection === 'connections'}
              onToggle={toggleSection}
            >
              <p className="mb-4 text-sm leading-6 text-slate-400">
                Saved in this browser as you edit. API keys are stored with this route on this device, so use it only on a trusted device.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="llm-url-input" className="mb-1.5 block text-xs font-medium text-slate-300">
                    Language-model endpoint URL
                  </label>
                  <input
                    id="llm-url-input"
                    type="text"
                    value={localConfig.baseUrl}
                    onChange={event => onConfigChange({ ...localConfig, baseUrl: event.target.value })}
                    className={monoInputClassName}
                    placeholder="e.g., http://localhost:8000/v1"
                  />
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {localConfig.engineType === 'vllm' && 'vLLM default: http://localhost:8000/v1'}
                    {localConfig.engineType === 'ollama' && 'Ollama default: http://localhost:11434'}
                    {localConfig.engineType === 'lmstudio' && 'LM Studio default: http://localhost:1234/v1'}
                    {(!localConfig.engineType || localConfig.engineType === 'custom') && 'Enter an OpenAI-compatible URL.'}
                  </p>
                </div>
                <div>
                  <label htmlFor="llm-api-key-input" className="mb-1.5 block text-xs font-medium text-slate-300">
                    Language-model API key
                  </label>
                  <input
                    id="llm-api-key-input"
                    type="password"
                    value={localConfig.apiKey || ''}
                    onChange={event => onConfigChange({ ...localConfig, apiKey: event.target.value })}
                    className={monoInputClassName}
                    placeholder="Optional API key"
                  />
                  <p className="mt-1 text-xs leading-5 text-slate-400">Sent as a Bearer token when provided.</p>
                </div>
                {localSpeechEnabled && (
                  <>
                    <div>
                      <label htmlFor="stt-url-input" className="mb-1.5 block text-xs font-medium text-slate-300">
                        Speech endpoint URL
                      </label>
                      <input
                        id="stt-url-input"
                        type="text"
                        value={localConfig.sttUrl}
                        onChange={event => onConfigChange({ ...localConfig, sttUrl: event.target.value })}
                        className={monoInputClassName}
                        placeholder="e.g., http://localhost:1234/v1"
                      />
                    </div>
                    <div>
                      <label htmlFor="stt-api-key-input" className="mb-1.5 block text-xs font-medium text-slate-300">
                        Speech API key
                      </label>
                      <input
                        id="stt-api-key-input"
                        type="password"
                        value={localConfig.sttApiKey || ''}
                        onChange={event => onConfigChange({ ...localConfig, sttApiKey: event.target.value })}
                        className={monoInputClassName}
                        placeholder="Optional API key"
                      />
                      <p className="mt-1 text-xs leading-5 text-slate-400">Required by hosted services such as Groq.</p>
                    </div>
                  </>
                )}
              </div>
            </Disclosure>
          )}

          {provider === ModelProvider.LOCAL && (
            <Disclosure
              id="models"
              title="Model selection"
              summary={localSpeechEnabled
                ? `${localConfig.llmModel} · ${localConfig.sttModel}`
                : localConfig.llmModel}
              open={openSection === 'models'}
              onToggle={toggleSection}
            >
              <div className="space-y-6">
                <div>
                  <div className="mb-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                    <div>
                      <label htmlFor="llm-model-identifier" className="block text-xs font-medium text-slate-300">
                        Language-model ID
                      </label>
                      <p className="mt-1 text-xs leading-5 text-slate-400">Enter an exact ID, discover available models, or choose a preset.</p>
                    </div>
                    <button
                      type="button"
                      onClick={onFetchModels}
                      disabled={isFetchingModels}
                      aria-busy={isFetchingModels}
                      aria-controls="llm-model-discovery-status"
                      className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-lg border border-indigo-400/40 bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50 motion-reduce:transition-none sm:self-auto"
                    >
                      <svg className={`h-4 w-4 ${isFetchingModels ? 'animate-spin motion-reduce:animate-none' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5.5 9A7.5 7.5 0 0118 6.5M18.5 15A7.5 7.5 0 016 17.5" />
                      </svg>
                      {isFetchingModels ? 'Discovering…' : 'Discover models'}
                    </button>
                  </div>
                  <input
                    id="llm-model-identifier"
                    type="text"
                    value={localConfig.llmModel}
                    onChange={event => onConfigChange({ ...localConfig, llmModel: event.target.value })}
                    className={monoInputClassName}
                    placeholder="e.g., gemma4 or openai/gpt-oss-20b"
                  />
                  <div
                    id="llm-model-discovery-status"
                    hidden={!fetchModelsStatus}
                    className="mt-2 rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-xs text-slate-300"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <p>{fetchModelsStatus}</p>
                    {fetchedModels && fetchedModels.length > 0 && (
                      <div className="mt-3">
                        <label htmlFor="llm-discovered-model-select" className="mb-1.5 block font-medium text-slate-300">
                          Discovered models
                        </label>
                        <select
                          id="llm-discovered-model-select"
                          value={fetchedModels.includes(localConfig.llmModel) ? localConfig.llmModel : ''}
                          onChange={event => event.target.value && onConfigChange({ ...localConfig, llmModel: event.target.value })}
                          className={`${inputClassName} cursor-pointer font-mono`}
                        >
                          <option value="">Choose a discovered model</option>
                          {fetchedModels.map(model => <option key={model} value={model}>{model}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <label htmlFor="llm-model-preset-select" className="mb-1.5 block text-xs font-medium text-slate-300">
                      Model presets
                    </label>
                    <select
                      id="llm-model-preset-select"
                      value={selectedLanguagePreset}
                      onChange={event => event.target.value && onConfigChange({ ...localConfig, llmModel: event.target.value })}
                      className={`${inputClassName} cursor-pointer font-mono`}
                    >
                      <option value="">Choose a preset</option>
                      {LANGUAGE_MODEL_PRESET_GROUPS.map(group => (
                        <optgroup key={group.label} label={group.label}>
                          {group.options.map(model => <option key={model} value={model}>{model}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>

                {localSpeechEnabled && (
                  <div className="border-t border-slate-800 pt-5">
                    <div className="mb-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                      <div>
                        <label htmlFor="stt-model-identifier" className="block text-xs font-medium text-slate-300">
                          Speech-model ID
                        </label>
                        <p className="mt-1 text-xs leading-5 text-slate-400">Enter an exact ID, discover available models, or choose a preset.</p>
                      </div>
                      <button
                        type="button"
                        onClick={onFetchSTTModels}
                        disabled={isFetchingSTTModels}
                        aria-busy={isFetchingSTTModels}
                        aria-controls="stt-model-discovery-status"
                        className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-lg border border-indigo-400/40 bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50 motion-reduce:transition-none sm:self-auto"
                      >
                        <svg className={`h-4 w-4 ${isFetchingSTTModels ? 'animate-spin motion-reduce:animate-none' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5.5 9A7.5 7.5 0 0118 6.5M18.5 15A7.5 7.5 0 016 17.5" />
                        </svg>
                        {isFetchingSTTModels ? 'Discovering…' : 'Discover models'}
                      </button>
                    </div>
                    <input
                      id="stt-model-identifier"
                      type="text"
                      value={localConfig.sttModel}
                      onChange={event => onConfigChange({ ...localConfig, sttModel: event.target.value })}
                      className={monoInputClassName}
                      placeholder="e.g., whisper-large-v3-turbo"
                    />
                    <div
                      id="stt-model-discovery-status"
                      hidden={!fetchSTTModelsStatus}
                      className="mt-2 rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-xs text-slate-300"
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      <p>{fetchSTTModelsStatus}</p>
                      {fetchedSTTModels && fetchedSTTModels.length > 0 && (
                        <div className="mt-3">
                          <label htmlFor="stt-discovered-model-select" className="mb-1.5 block font-medium text-slate-300">
                            Discovered speech models
                          </label>
                          <select
                            id="stt-discovered-model-select"
                            value={fetchedSTTModels.includes(localConfig.sttModel) ? localConfig.sttModel : ''}
                            onChange={event => event.target.value && onConfigChange({ ...localConfig, sttModel: event.target.value })}
                            className={`${inputClassName} cursor-pointer font-mono`}
                          >
                            <option value="">Choose a discovered model</option>
                            {fetchedSTTModels.map(model => <option key={model} value={model}>{model}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="mt-3">
                      <label htmlFor="stt-model-preset-select" className="mb-1.5 block text-xs font-medium text-slate-300">
                        Speech-model presets
                      </label>
                      <select
                        id="stt-model-preset-select"
                        value={selectedSpeechPreset}
                        onChange={event => event.target.value && onConfigChange({ ...localConfig, sttModel: event.target.value })}
                        className={`${inputClassName} cursor-pointer font-mono`}
                      >
                        <option value="">Choose a preset</option>
                        {SPEECH_MODEL_PRESET_GROUPS.map(group => (
                          <optgroup key={group.label} label={group.label}>
                            {group.options.map(model => <option key={model} value={model}>{model}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </Disclosure>
          )}

          {provider === ModelProvider.LOCAL && (
            <Disclosure
              id="launch"
              title="Launch help"
              summary={localSpeechEnabled ? `${selectedEngineName} · ${selectedSTTEngineName}` : selectedEngineName}
              open={openSection === 'launch'}
              onToggle={toggleSection}
            >
              <div className="grid grid-cols-1 gap-5 font-mono text-xs leading-5 text-indigo-300 lg:grid-cols-2">
                <div className="min-w-0 overflow-x-auto">
                  <p className="mb-2 font-sans text-sm font-semibold text-slate-200">Language model</p>
                  {localConfig.engineType === 'vllm' && (
                    <>
                      <span className="text-emerald-300">vllm serve google/gemma-4-9b-it --port 8000</span><br />
                      <span className="text-slate-400"># or for GPT-OSS:</span><br />
                      <span className="text-emerald-300">vllm serve openai/gpt-oss-13b --port 8000</span>
                    </>
                  )}
                  {localConfig.engineType === 'ollama' && (
                    <>
                      <span className="text-emerald-300">ollama run gemma4</span><br />
                      <span className="text-emerald-300">ollama run gpt-oss</span>
                    </>
                  )}
                  {localConfig.engineType === 'lmstudio' && (
                    <span>Load Gemma 4 or GPT-OSS in LM Studio, then start the server on port 1234.</span>
                  )}
                  {localConfig.engineType === 'custom' && (
                    <span>Expose an OpenAI-compatible /v1/chat/completions endpoint.</span>
                  )}
                </div>

                {localSpeechEnabled && (
                  <div className="min-w-0 overflow-x-auto border-t border-slate-800 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                    <p className="mb-2 font-sans text-sm font-semibold text-slate-200">Speech recognition · {selectedSTTEngineName}</p>
                    {localConfig.sttEngine === 'faster_whisper' && (
                      <>
                        <span className="text-emerald-300">faster-whisper-server --port 1234</span><br />
                        <span className="text-slate-400"># or whisper.cpp server:</span><br />
                        <span className="text-emerald-300">./server -m models/ggml-large-v3-turbo.bin --port 1234</span>
                      </>
                    )}
                    {localConfig.sttEngine === 'vllm_stt' && (
                      <span className="text-emerald-300">vllm serve whisper-large-v3-turbo --port 8000</span>
                    )}
                    {localConfig.sttEngine === 'groq_stt' && (
                      <span className="text-emerald-300">Endpoint: https://api.groq.com/openai/v1 (requires a Groq API key)</span>
                    )}
                    {localConfig.sttEngine === 'ollama_stt' && (
                      <span className="text-emerald-300">ollama run whisper</span>
                    )}
                    {localConfig.sttEngine === 'custom_stt' && (
                      <span>Expose /v1/audio/transcriptions at the configured endpoint.</span>
                    )}
                  </div>
                )}
              </div>
            </Disclosure>
          )}
        </div>
      </fieldset>
    </div>
  );
};
