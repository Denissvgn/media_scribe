import React, { useState, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { TranscriptionDisplay } from './components/TranscriptionDisplay';
import { AppStatus, ModelProvider, TranscriptionMode, LocalConfig, LocalEngineType, STTEngineType } from './types';
import { transcribeAudio, fetchLocalModels, fetchLocalSTTModels } from './services/geminiService';
import { Button } from './components/Button';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [file, setFile] = useState<File | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  const [termsText, setTermsText] = useState<string>('');
  const [termsList, setTermsList] = useState<string[]>([]);
  const [termsFileName, setTermsFileName] = useState<string | null>(null);
  const [isDraggingTerms, setIsDraggingTerms] = useState(false);

  const parseAndSetTerms = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    setTermsList(lines);
    setTermsText(text);
  };

  const handleTermsFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingTerms(false);
    const selectedFile = e.dataTransfer.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.txt') && selectedFile.type !== 'text/plain') {
      alert('Please upload a plain text file (.txt) containing terms.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseAndSetTerms(text);
      setTermsFileName(selectedFile.name);
    };
    reader.readAsText(selectedFile);
  };

  const handleTermsFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.txt') && selectedFile.type !== 'text/plain') {
      alert('Please upload a plain text file (.txt) containing terms.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseAndSetTerms(text);
      setTermsFileName(selectedFile.name);
    };
    reader.readAsText(selectedFile);
  };

  const handleTermsTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    parseAndSetTerms(value);
  };

  const handleClearTerms = () => {
    setTermsText('');
    setTermsList([]);
    setTermsFileName(null);
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

  const handleFetchModels = async () => {
    setIsFetchingModels(true);
    setFetchModelsStatus("Querying server endpoint for active loaded models...");
    setFetchedModels(null);
    try {
      const models = await fetchLocalModels(localConfig.baseUrl, localConfig.apiKey);
      if (models && models.length > 0) {
        setFetchedModels(models);
        setFetchModelsStatus(`Successfully discovered ${models.length} loaded LLM model(s)!`);
      } else {
        setFetchedModels([]);
        setFetchModelsStatus("No models returned. Verify server status and CORS configuration.");
      }
    } catch (err: any) {
      setFetchModelsStatus(`Discovery failed: ${err.message || 'Network error'}`);
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleFetchSTTModels = async () => {
    setIsFetchingSTTModels(true);
    setFetchSTTModelsStatus("Querying STT server for active speech recognition models...");
    setFetchedSTTModels(null);
    try {
      const models = await fetchLocalSTTModels(localConfig.sttUrl, localConfig.sttApiKey || localConfig.apiKey);
      if (models && models.length > 0) {
        setFetchedSTTModels(models);
        setFetchSTTModelsStatus(`Successfully discovered ${models.length} active STT model(s)!`);
      } else {
        setFetchedSTTModels([]);
        setFetchSTTModelsStatus("No STT models returned. Check local STT server logs.");
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

  const [showSettings, setShowSettings] = useState(true);

  // Sync settings to localStorage
  useEffect(() => {
    localStorage.setItem('model_provider', provider);
  }, [provider]);

  useEffect(() => {
    localStorage.setItem('local_config', JSON.stringify(localConfig));
  }, [localConfig]);

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

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setStatus(AppStatus.IDLE);
    setTranscription('');
    setError(null);
  };

  const handleTranscribe = async () => {
    if (!file) return;

    setStatus(AppStatus.PROCESSING);
    setUploadProgress(0);
    setProcessingStatus('Starting server transmission...');
    setError(null);

    try {
      const result = await transcribeAudio(
        file, 
        (percent) => {
          setUploadProgress(percent);
          if (percent === 100) {
            setProcessingStatus('Transmission complete! Processing transcription on the model backend...');
          } else {
            setProcessingStatus(`Uploading file: ${percent}%`);
          }
        },
        provider,
        localConfig,
        (statusMessage) => {
          setProcessingStatus(statusMessage);
        },
        termsList
      );
      setTranscription(result);
      setStatus(AppStatus.COMPLETED);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during transcription.");
      setStatus(AppStatus.ERROR);
    } finally {
      setUploadProgress(null);
      setProcessingStatus('');
    }
  };

  const handleReset = () => {
    setFile(null);
    setTranscription('');
    setStatus(AppStatus.IDLE);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-indigo-500/30 selection:text-indigo-200">
      
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/20 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        
        {/* Header */}
        <header className="mb-12 text-center">
          <div className="inline-flex items-center justify-center p-3 mb-6 rounded-2xl bg-slate-900/50 ring-1 ring-slate-800 shadow-xl">
            <svg className="w-8 h-8 text-indigo-500 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v-4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              Media Scribe
            </h1>
          </div>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            Transform audio & video into structured transcriptions using <strong>Local LLMs & STT (vLLM, Gemma 4, GPT-OSS, Ollama, Whisper)</strong> or <strong>Google Gemini Cloud</strong>. Private, fast, and 100% offline ready.
          </p>
        </header>

        {/* Main Content Area */}
        <main className="space-y-8">

          {/* Model Processing Engine Settings */}
          <section className="bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-800 p-6 shadow-xl relative overflow-hidden transition-all duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 animate-fadeIn">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066-1.543.94-3.31-.826-2.37-2.37c-.708-.43-1.065-1.123-1.065-2.572-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543-.826-3.31-2.37-2.37-.996.608-2.296.07-2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Translation & Processing Engine
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Select between Cloud Gemini or local inference engines (Ollama, LM Studio) to handle transcription.
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 self-start sm:self-center"
              >
                {showSettings ? "Collapse options" : "Configure endpoints"}
                <svg className={`w-4 h-4 transition-transform duration-200 ${showSettings ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Selector Buttons */}
            <div className="grid grid-cols-2 gap-3 p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setProvider(ModelProvider.GEMINI)}
                className={`py-2 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
                  provider === ModelProvider.GEMINI
                    ? "bg-indigo-600/90 text-white shadow-lg shadow-indigo-500/10"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
                Google Gemini Cloud
              </button>
              <button
                type="button"
                onClick={() => setProvider(ModelProvider.LOCAL)}
                className={`py-2 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
                  provider === ModelProvider.LOCAL
                    ? "bg-indigo-600/90 text-white shadow-lg shadow-indigo-500/10"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Local Models (Ollama / Gemma)
              </button>
            </div>

            {/* Local Config Fields */}
            {provider === ModelProvider.LOCAL && showSettings && (
              <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-5 animate-fadeIn">
                
                {/* Local Engine Architecture Selector */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
                    Local Inference Backend / Engine Framework
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'vllm', name: 'vLLM Library', desc: 'Port 8000 / OpenAI API' },
                      { id: 'ollama', name: 'Ollama Native', desc: 'Port 11434' },
                      { id: 'lmstudio', name: 'LM Studio', desc: 'Port 1234 / OpenAI API' },
                      { id: 'custom', name: 'Custom OpenAI', desc: 'Bearer token / Custom' }
                    ].map((eng) => (
                      <button
                        type="button"
                        key={eng.id}
                        onClick={() => handleEngineChange(eng.id as LocalEngineType)}
                        className={`p-2.5 rounded-xl text-left transition-all border ${
                          (localConfig.engineType || 'vllm') === eng.id
                            ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-200 shadow-md shadow-indigo-500/5"
                            : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                        }`}
                      >
                        <div className="font-semibold text-xs flex items-center justify-between">
                          {eng.name}
                          {(localConfig.engineType || 'vllm') === eng.id && (
                            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">{eng.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Base URL and API Key Inputs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                      Local Server Base URL
                    </label>
                    <input
                      type="text"
                      value={localConfig.baseUrl}
                      onChange={(e) => setLocalConfig({ ...localConfig, baseUrl: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      placeholder="e.g., http://localhost:8000/v1"
                    />
                    <p className="text-[10px] text-indigo-400/80 mt-1 flex items-center gap-1">
                      <span>💡</span>
                      {localConfig.engineType === 'vllm' && 'vLLM default server is http://localhost:8000/v1'}
                      {localConfig.engineType === 'ollama' && 'Ollama default server is http://localhost:11434'}
                      {localConfig.engineType === 'lmstudio' && 'LM Studio default server is http://localhost:1234/v1'}
                      {(!localConfig.engineType || localConfig.engineType === 'custom') && 'Custom OpenAI-compatible URL'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                      Optional Auth Key / Bearer Token
                    </label>
                    <input
                      type="password"
                      value={localConfig.apiKey || ''}
                      onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      placeholder="Optional API key or Bearer token (if required)"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Passed as Authorization Bearer header if provided.
                    </p>
                  </div>
                </div>

                {/* Model Identifier Selection & Auto Discovery */}
                <div className="pt-2 border-t border-slate-900">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Active LLM Model Identifier (e.g., gemma4, gpt-oss)
                    </label>
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={isFetchingModels}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-lg border border-indigo-500/20 transition-all self-start sm:self-auto cursor-pointer disabled:opacity-50"
                    >
                      <svg className={`w-3.5 h-3.5 ${isFetchingModels ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {isFetchingModels ? "Querying server..." : "Auto-Discover Loaded Models"}
                    </button>
                  </div>

                  <input
                    type="text"
                    value={localConfig.llmModel}
                    onChange={(e) => setLocalConfig({ ...localConfig, llmModel: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    placeholder="e.g., gemma4, google/gemma-4-9b-it, or gpt-oss"
                  />

                  {/* Status / Active models select dropdown */}
                  {fetchModelsStatus && (
                    <div className="mt-2 text-[11px] text-slate-300 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                      <p>{fetchModelsStatus}</p>
                      {fetchedModels && fetchedModels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                          <span className="text-slate-400 font-medium text-[10px]">Select active model:</span>
                          {fetchedModels.map((m) => (
                            <button
                              type="button"
                              key={m}
                              onClick={() => setLocalConfig({ ...localConfig, llmModel: m })}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                                localConfig.llmModel === m
                                  ? "bg-indigo-500 text-white border-indigo-400 font-bold"
                                  : "bg-slate-800 hover:bg-slate-700 text-indigo-300 border-indigo-500/30"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Curated Preset Chips */}
                  <div className="mt-3 space-y-2">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                      Quick Model Presets:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {/* Gemma 4 Family */}
                      <span className="text-[10px] text-indigo-400/90 font-medium self-center mr-1">Gemma 4:</span>
                      {['gemma4', 'gemma-4-9b-it', 'google/gemma-4-27b-it'].map((item) => (
                        <button
                          type="button"
                          key={item}
                          onClick={() => setLocalConfig({ ...localConfig, llmModel: item })}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                            localConfig.llmModel === item
                              ? "bg-indigo-500/30 text-indigo-200 border-indigo-400"
                              : "bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-800"
                          }`}
                        >
                          {item}
                        </button>
                      ))}

                      {/* GPT-OSS Family */}
                      <span className="text-[10px] text-emerald-400/90 font-medium self-center ml-2 mr-1">GPT-OSS:</span>
                      {['gpt-oss', 'gpt-oss-13b', 'openai/gpt-oss-20b'].map((item) => (
                        <button
                          type="button"
                          key={item}
                          onClick={() => setLocalConfig({ ...localConfig, llmModel: item })}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                            localConfig.llmModel === item
                              ? "bg-emerald-500/30 text-emerald-200 border-emerald-400"
                              : "bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-800"
                          }`}
                        >
                          {item}
                        </button>
                      ))}

                      {/* Open Models */}
                      <span className="text-[10px] text-sky-400/90 font-medium self-center ml-2 mr-1">Open:</span>
                      {['gemma2', 'llama3.3', 'qwen2.5', 'mistral'].map((item) => (
                        <button
                          type="button"
                          key={item}
                          onClick={() => setLocalConfig({ ...localConfig, llmModel: item })}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                            localConfig.llmModel === item
                              ? "bg-sky-500/30 text-sky-200 border-sky-400"
                              : "bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-800"
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Local Processing Mode */}
                <div className="pt-2 border-t border-slate-900/80">
                  <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
                    Local Processing Strategy
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${
                      localConfig.transcriptionMode === TranscriptionMode.HYBRID
                        ? "bg-indigo-950/20 border-indigo-500/20 text-indigo-200"
                        : "bg-slate-900/30 border-slate-800 text-slate-400 hover:bg-slate-900/50"
                    }`}>
                      <span className="flex items-center gap-2 font-medium text-xs">
                        <input
                          type="radio"
                          name="transcriptionMode"
                          checked={localConfig.transcriptionMode === TranscriptionMode.HYBRID}
                          onChange={() => setLocalConfig({ ...localConfig, transcriptionMode: TranscriptionMode.HYBRID })}
                          className="accent-indigo-500"
                        />
                        Hybrid Pipeline (Fast Cloud STT + Local vLLM/Gemma Refinement)
                      </span>
                      <span className="text-[10px] opacity-70 mt-1 pl-5 leading-normal">
                        Cloud Gemini quickly transcribes raw audio up to 500MB, then your local vLLM / Gemma 4 / GPT-OSS structures & formats the final document offline.
                      </span>
                    </label>

                    <label className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${
                      localConfig.transcriptionMode === TranscriptionMode.LOCAL_STT
                        ? "bg-indigo-950/20 border-indigo-500/20 text-indigo-200"
                        : "bg-slate-900/30 border-slate-800 text-slate-400 hover:bg-slate-900/50"
                    }`}>
                      <span className="flex items-center gap-2 font-medium text-xs">
                        <input
                          type="radio"
                          name="transcriptionMode"
                          checked={localConfig.transcriptionMode === TranscriptionMode.LOCAL_STT}
                          onChange={() => setLocalConfig({ ...localConfig, transcriptionMode: TranscriptionMode.LOCAL_STT })}
                          className="accent-indigo-500"
                        />
                        100% Offline (Local Whisper STT + Local vLLM/Gemma)
                      </span>
                      <span className="text-[10px] opacity-70 mt-1 pl-5 leading-normal">
                        Fully local flow. Audio is transcribed via local Whisper server, then processed locally by vLLM or Ollama.
                      </span>
                    </label>
                  </div>
                </div>

                {localConfig.transcriptionMode === TranscriptionMode.LOCAL_STT && (
                  <div className="pt-3 border-t border-slate-900 space-y-4">
                    {/* STT Engine Architecture Selector */}
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
                        Speech Recognition (STT) Engine & Provider
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {[
                          { id: 'faster_whisper', name: 'Faster-Whisper', desc: 'Port 1234 / High speed' },
                          { id: 'vllm_stt', name: 'vLLM Audio', desc: 'Port 8000 / vLLM STT' },
                          { id: 'groq_stt', name: 'Groq Cloud STT', desc: 'Real-time Fast Cloud' },
                          { id: 'ollama_stt', name: 'Ollama Audio', desc: 'Port 11434 / Whisper' },
                          { id: 'custom_stt', name: 'Custom Endpoint', desc: 'Custom OpenAI STT' },
                        ].map((eng) => (
                          <button
                            type="button"
                            key={eng.id}
                            onClick={() => handleSTTEngineChange(eng.id as STTEngineType)}
                            className={`p-2 rounded-xl text-left transition-all border ${
                              (localConfig.sttEngine || 'faster_whisper') === eng.id
                                ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-200 shadow-md shadow-indigo-500/5"
                                : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                            }`}
                          >
                            <div className="font-semibold text-xs flex items-center justify-between">
                              {eng.name}
                              {(localConfig.sttEngine || 'faster_whisper') === eng.id && (
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                              )}
                            </div>
                            <div className="text-[9px] text-slate-500 mt-0.5 truncate">{eng.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* STT URL, API Key, and Spoken Language */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                          STT Endpoint URL
                        </label>
                        <input
                          type="text"
                          value={localConfig.sttUrl}
                          onChange={(e) => setLocalConfig({ ...localConfig, sttUrl: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                          placeholder="e.g., http://localhost:1234/v1 or https://api.groq.com/openai/v1"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                          Dedicated STT Auth / API Key
                        </label>
                        <input
                          type="password"
                          value={localConfig.sttApiKey || ''}
                          onChange={(e) => setLocalConfig({ ...localConfig, sttApiKey: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                          placeholder="Optional (e.g. gsk_... for Groq)"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                          Audio Spoken Language
                        </label>
                        <select
                          value={localConfig.sttLanguage || 'auto'}
                          onChange={(e) => setLocalConfig({ ...localConfig, sttLanguage: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono cursor-pointer"
                        >
                          <option value="auto">🌐 Auto-Detect Language</option>
                          <option value="en">🇺🇸 English (en)</option>
                          <option value="es">🇪🇸 Spanish (es)</option>
                          <option value="fr">🇫🇷 French (fr)</option>
                          <option value="de">🇩🇪 German (de)</option>
                          <option value="zh">🇨🇳 Chinese (zh)</option>
                          <option value="ja">🇯🇵 Japanese (ja)</option>
                          <option value="ru">🇷🇺 Russian (ru)</option>
                          <option value="pt">🇵🇹 Portuguese (pt)</option>
                          <option value="it">🇮🇹 Italian (it)</option>
                        </select>
                      </div>
                    </div>

                    {/* Active STT Model Identifier & Discovery */}
                    <div className="pt-2 border-t border-slate-900/80">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
                        <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                          Active STT Model Identifier
                        </label>
                        <button
                          type="button"
                          onClick={handleFetchSTTModels}
                          disabled={isFetchingSTTModels}
                          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-lg border border-indigo-500/20 transition-all self-start sm:self-auto cursor-pointer disabled:opacity-50"
                        >
                          <svg className={`w-3.5 h-3.5 ${isFetchingSTTModels ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          {isFetchingSTTModels ? "Querying STT server..." : "Auto-Discover STT Models"}
                        </button>
                      </div>

                      <input
                        type="text"
                        value={localConfig.sttModel}
                        onChange={(e) => setLocalConfig({ ...localConfig, sttModel: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="e.g. whisper-large-v3-turbo, SenseVoiceSmall, distil-whisper-large-v3"
                      />

                      {fetchSTTModelsStatus && (
                        <div className="mt-2 text-[11px] text-slate-300 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                          <p>{fetchSTTModelsStatus}</p>
                          {fetchedSTTModels && fetchedSTTModels.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                              <span className="text-slate-400 font-medium text-[10px]">Select active STT model:</span>
                              {fetchedSTTModels.map((m) => (
                                <button
                                  type="button"
                                  key={m}
                                  onClick={() => setLocalConfig({ ...localConfig, sttModel: m })}
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                                    localConfig.sttModel === m
                                      ? "bg-indigo-500 text-white border-indigo-400 font-bold"
                                      : "bg-slate-800 hover:bg-slate-700 text-indigo-300 border-indigo-500/30"
                                  }`}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Capable Presets for Modern Real-Time & High Precision Models */}
                      <div className="mt-3 space-y-2">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                          Modern Capable & Real-Time STT Presets:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {/* Real-time / Low Latency */}
                          <span className="text-[10px] text-amber-400/90 font-medium self-center mr-1">⚡ Real-Time Fast:</span>
                          {[
                            'whisper-large-v3-turbo',
                            'distil-whisper-large-v3',
                            'SenseVoiceSmall',
                            'moonshine/base'
                          ].map((item) => (
                            <button
                              type="button"
                              key={item}
                              onClick={() => setLocalConfig({ ...localConfig, sttModel: item })}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                                localConfig.sttModel === item
                                  ? "bg-amber-500/30 text-amber-200 border-amber-400"
                                  : "bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-800"
                              }`}
                            >
                              {item}
                            </button>
                          ))}

                          {/* Gold Standard High Precision */}
                          <span className="text-[10px] text-indigo-400/90 font-medium self-center ml-2 mr-1">🎯 High Precision:</span>
                          {[
                            'whisper-large-v3',
                            'whisper-medium',
                            'whisper-1'
                          ].map((item) => (
                            <button
                              type="button"
                              key={item}
                              onClick={() => setLocalConfig({ ...localConfig, sttModel: item })}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                                localConfig.sttModel === item
                                  ? "bg-indigo-500/30 text-indigo-200 border-indigo-400"
                                  : "bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-800"
                              }`}
                            >
                              {item}
                            </button>
                          ))}

                          {/* Multimodal Audio-LLMs */}
                          <span className="text-[10px] text-purple-400/90 font-medium self-center ml-2 mr-1">🎙️ Audio LLM:</span>
                          {[
                            'Qwen/Qwen2-Audio-7B-Instruct'
                          ].map((item) => (
                            <button
                              type="button"
                              key={item}
                              onClick={() => setLocalConfig({ ...localConfig, sttModel: item })}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                                localConfig.sttModel === item
                                  ? "bg-purple-500/30 text-purple-200 border-purple-400"
                                  : "bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-800"
                              }`}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Engine Command Help Snippet */}
                <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-2 font-mono">
                  <div className="text-slate-300 font-sans font-semibold flex items-center justify-between">
                    <span>⚡ Quick Terminal Launch Snippet ({localConfig.engineType || 'vLLM'} + {localConfig.sttEngine || 'Faster-Whisper'}):</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-indigo-300">
                    {/* LLM Engine Command */}
                    <div className="bg-slate-950 p-2 rounded border border-slate-800/80 overflow-x-auto space-y-0.5">
                      <div className="text-[10px] text-slate-400 font-sans font-semibold mb-1">🤖 LLM Server:</div>
                      {localConfig.engineType === 'vllm' && (
                        <>
                          <span className="text-emerald-400">vllm serve google/gemma-4-9b-it --port 8000</span><br/>
                          <span className="text-slate-500"># or for GPT-OSS:</span><br/>
                          <span className="text-emerald-400">vllm serve openai/gpt-oss-13b --port 8000</span>
                        </>
                      )}
                      {localConfig.engineType === 'ollama' && (
                        <>
                          <span className="text-emerald-400">ollama run gemma4</span><br/>
                          <span className="text-emerald-400">ollama run gpt-oss</span>
                        </>
                      )}
                      {localConfig.engineType === 'lmstudio' && (
                        <span>Load Gemma 4 / GPT-OSS in LM Studio & start server on port 1234.</span>
                      )}
                      {localConfig.engineType === 'custom' && (
                        <span>OpenAI-compatible server exposing /v1/chat/completions</span>
                      )}
                    </div>

                    {/* STT Engine Command */}
                    {localConfig.transcriptionMode === TranscriptionMode.LOCAL_STT && (
                      <div className="bg-slate-950 p-2 rounded border border-slate-800/80 overflow-x-auto space-y-0.5">
                        <div className="text-[10px] text-slate-400 font-sans font-semibold mb-1">🎙️ STT Engine ({localConfig.sttEngine || 'faster_whisper'}):</div>
                        {localConfig.sttEngine === 'faster_whisper' && (
                          <>
                            <span className="text-emerald-400">faster-whisper-server --port 1234</span><br/>
                            <span className="text-slate-500"># or whisper.cpp server:</span><br/>
                            <span className="text-emerald-400">./server -m models/ggml-large-v3-turbo.bin --port 1234</span>
                          </>
                        )}
                        {localConfig.sttEngine === 'vllm_stt' && (
                          <span className="text-emerald-400">vllm serve whisper-large-v3-turbo --port 8000</span>
                        )}
                        {localConfig.sttEngine === 'groq_stt' && (
                          <span className="text-emerald-400">Endpoint: https://api.groq.com/openai/v1 (Requires Groq API Key)</span>
                        )}
                        {localConfig.sttEngine === 'ollama_stt' && (
                          <span className="text-emerald-400">ollama run whisper</span>
                        )}
                        {localConfig.sttEngine === 'custom_stt' && (
                          <span>Expose /v1/audio/transcriptions on your local endpoint</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}

            {provider === ModelProvider.GEMINI && showSettings && (
              <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs text-slate-400 animate-fadeIn">
                <p className="font-semibold text-slate-300">Cloud Processing Engine Configuration</p>
                <p>• Model: <span className="font-mono text-indigo-400">gemini-3.5-flash</span> (supports large audio streams + video files natively)</p>
                <p>• Max Payload: <span className="text-indigo-400">500MB per file</span>, powered by Gemini File API uploads</p>
                <p>• Cleanups: Immediate temp file unlinking on Cloud Run, automatic remote deletion after transcription is generated.</p>
              </div>
            )}
          </section>

          {/* Section 1: Upload & Preview */}
          <section className="grid gap-8 lg:grid-cols-2">
            
            {/* Left Col: Uploader */}
            <div className="space-y-6">
              <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-800 p-6 shadow-xl">
                 <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-slate-200">Upload File</h2>
                    {file && (
                      <button 
                        onClick={handleReset}
                        className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                 </div>
                 
                 {!file ? (
                   <FileUploader onFileSelect={handleFileSelect} />
                 ) : (
                   <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 flex flex-col items-center justify-center space-y-4 animate-fadeIn">
                      <div className="w-16 h-16 rounded-full bg-indigo-500/20 flex items-center justify-center">
                        <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-slate-200 break-all">{file.name}</p>
                        <p className="text-sm text-slate-500 mt-1">
                          {(file.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                      
                      {objectUrl && (
                        file.name.toLowerCase().endsWith('.mp4') || file.name.toLowerCase().endsWith('.mov') || file.type.startsWith('video/mp4') || file.type.startsWith('video/quicktime') ? (
                          <video 
                            controls 
                            src={objectUrl} 
                            className="w-full mt-4 rounded-lg bg-slate-950 border border-slate-700 max-h-48"
                          />
                        ) : (
                          <audio 
                            controls 
                            src={objectUrl} 
                            className="w-full mt-4 h-10 rounded-lg"
                          />
                        )
                      )}
                   </div>
                 )}

                 {file && status !== AppStatus.PROCESSING && status !== AppStatus.COMPLETED && (
                   <div className="mt-6">
                     <Button 
                        onClick={handleTranscribe} 
                        className="w-full py-3 text-lg"
                        isLoading={status === AppStatus.PROCESSING}
                      >
                        Start Transcription
                      </Button>
                   </div>
                 )}
                 
                 {status === AppStatus.PROCESSING && (
                    <div className="mt-6 flex flex-col items-center space-y-3 p-4 bg-indigo-900/10 rounded-xl border border-indigo-500/20">
                      <div className="w-full max-w-xs bg-slate-700 h-1.5 rounded-full overflow-hidden">
									{uploadProgress !== null && uploadProgress < 100 ? (
										<div 
											className="h-full bg-indigo-500 transition-all duration-300 ease-out"
											style={{ width: `${uploadProgress}%` }}
										/>
									) : (
										<div className="h-full bg-indigo-500 animate-progress"></div>
									)}
								</div>
								<p className="text-sm text-indigo-300 text-center animate-pulse">
									{processingStatus || "Analyzing audio & generating text..."}
								</p>
                    </div>
                 )}

                 {error && (
                    <div className="mt-6 p-4 rounded-xl bg-red-900/20 border border-red-500/30 text-red-200 text-sm flex items-start gap-3">
                       <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                       </svg>
                       {error}
                    </div>
                 )}
              </div>
              {/* Custom Terms Card */}
              <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-800 p-6 shadow-xl space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                      <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Speech Hints & Custom Terms
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Upload a text file with terms (one per line) to correct phonetic spelling.
                    </p>
                  </div>
                  {termsList.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearTerms}
                      className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingTerms(true); }}
                  onDragLeave={() => setIsDraggingTerms(false)}
                  onDrop={handleTermsFileDrop}
                  className={`
                    relative rounded-xl border border-dashed p-4 text-center transition-all duration-200 cursor-pointer
                    ${isDraggingTerms 
                      ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]' 
                      : 'border-slate-700 hover:border-indigo-500 bg-slate-950/20 hover:bg-slate-950/40'
                    }
                  `}
                  onClick={() => document.getElementById('terms-file-input')?.click()}
                >
                  <input
                    id="terms-file-input"
                    type="file"
                    accept=".txt,text/plain"
                    onChange={handleTermsFileSelect}
                    className="hidden"
                  />
                  
                  <div className="flex flex-col items-center justify-center space-y-1.5 pointer-events-none">
                    <svg className="w-6 h-6 text-indigo-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <p className="text-xs font-medium text-slate-300">
                      {termsFileName ? `File: ${termsFileName}` : "Upload terms list (.txt)"}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Drag & drop or click to select text file
                    </p>
                  </div>
                </div>

                {/* Inline Editing Textarea */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-medium text-slate-400 uppercase tracking-wider">
                    <span>Inline Terms List</span>
                    {termsList.length > 0 && (
                      <span className="text-indigo-400 normal-case font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 flex items-center gap-1 text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                        {termsList.length} term{termsList.length === 1 ? '' : 's'} active
                      </span>
                    )}
                  </div>
                  <textarea
                    rows={4}
                    value={termsText}
                    onChange={handleTermsTextChange}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono placeholder:text-slate-600 resize-none leading-relaxed"
                    placeholder={`Type terms manually or split them by lines, e.g.:
DenisSvgn
Google Gemini
DeepMind
Ollama`}
                  />
                </div>
              </div>
            </div>

            {/* Right Col: Results */}
            <div className="h-full min-h-[400px]">
               {transcription ? (
                 <TranscriptionDisplay text={transcription} />
               ) : (
                 <div className="h-full w-full rounded-2xl border border-slate-800 bg-slate-900/30 flex flex-col items-center justify-center text-slate-500 p-8 border-dashed">
                   <div className="w-16 h-16 rounded-full bg-slate-800/50 mb-4 flex items-center justify-center">
                     <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                     </svg>
                   </div>
                   <p className="text-lg font-medium">No transcription yet</p>
                   <p className="text-sm opacity-60">Upload a file to see the results here</p>
                 </div>
               )}
            </div>

          </section>
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
      `}</style>
    </div>
  );
};

export default App;
