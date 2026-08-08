import {
  ActionableWorkflowError,
  CompatibilityCheck,
  CompatibilityReport,
  LocalConfig,
  ModelProvider,
  TranscriptionCallbacks,
  TranscriptionMode,
  TranscriptionRequest,
  WorkflowStage
} from "../types";

type EndpointProtocol = 'openai' | 'ollama';
type EndpointTransport = 'direct' | 'server-proxy';

interface EndpointDescriptor {
  protocol: EndpointProtocol;
  baseUrl: string;
  modelsUrl: string;
  inferenceUrl: string;
}

interface RequestResult {
  response: Response;
  transport: EndpointTransport;
}

const createAbortError = () => new DOMException('The operation was canceled.', 'AbortError');

export const isAbortError = (error: unknown) => (
  error instanceof DOMException
    ? error.name === 'AbortError'
    : Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
);

const safeTechnicalDetail = (value: unknown) => String(value || '')
  .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
  .replace(/[?&](key|api_key|token)=[^&\s]+/gi, '$1=[redacted]')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 300);

export class TranscriptionWorkflowError extends Error {
  readonly info: ActionableWorkflowError;

  constructor(info: ActionableWorkflowError) {
    super(info.message);
    this.name = 'TranscriptionWorkflowError';
    this.info = info;
  }
}

const buildWorkflowError = (
  stage: WorkflowStage,
  code: ActionableWorkflowError['code'],
  title: string,
  message: string,
  suggestion: string,
  recovery: ActionableWorkflowError['recovery'],
  retryable: boolean,
  status?: number,
  technicalDetail?: unknown
): ActionableWorkflowError => ({
  stage,
  code,
  title,
  message,
  suggestion,
  recovery,
  retryable,
  status,
  technicalDetail: technicalDetail ? safeTechnicalDetail(technicalDetail) : undefined
});

export const normalizeTranscriptionError = (
  error: unknown,
  stage: WorkflowStage = 'transcription'
): ActionableWorkflowError => {
  if (error instanceof TranscriptionWorkflowError) return error.info;
  if (isAbortError(error)) {
    return buildWorkflowError(stage, 'CANCELLED', 'Transcription canceled', 'The active request was canceled.', 'Your file and settings are still available.', 'retry', true);
  }

  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('api key')) {
    return buildWorkflowError(stage, 'AUTH_FAILED', 'Authentication failed', 'The selected service rejected its credentials.', 'Review the API key in Expert settings, then test the route again.', 'settings', false, undefined, message);
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return buildWorkflowError(stage, 'RATE_LIMITED', 'Service rate limit reached', 'The selected service is temporarily limiting requests.', 'Wait a moment, then retry this transcription.', 'retry', true, 429, message);
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return buildWorkflowError(stage, 'TIMEOUT', 'The request timed out', 'The service did not finish within the allowed time.', 'Confirm the endpoint is responsive, then retry.', 'retry', true, 504, message);
  }
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('overloaded')) {
    return buildWorkflowError(stage, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', 'The selected transcription service is not ready right now.', 'Wait briefly and retry without choosing the file again.', 'retry', true, 503, message);
  }
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('connection')) {
    return buildWorkflowError(stage, 'ENDPOINT_UNREACHABLE', 'Could not reach the processing route', 'One of the configured endpoints did not respond.', 'Start the service or correct its URL in Expert settings, then test the route.', 'settings', true, undefined, message);
  }
  return buildWorkflowError(stage, 'UNKNOWN', 'Transcription could not finish', 'The current attempt stopped before a final transcript was created.', 'Your file, terms, and any recovered raw transcript have been preserved.', 'retry', true, undefined, message);
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw createAbortError();
};

const abortableDelay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  throwIfAborted(signal);
  const timeoutId = window.setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, milliseconds);
  const handleAbort = () => {
    window.clearTimeout(timeoutId);
    reject(createAbortError());
  };
  signal?.addEventListener('abort', handleAbort, { once: true });
});

const PREFLIGHT_TIMEOUT_MS = 30_000;

const withPreflightTimeout = async <T>(
  signal: AbortSignal | undefined,
  operation: (timeoutSignal: AbortSignal) => Promise<T>
): Promise<T> => {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PREFLIGHT_TIMEOUT_MS);

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (timedOut && isAbortError(error)) {
      throw new TranscriptionWorkflowError(buildWorkflowError(
        'preflight',
        'TIMEOUT',
        'Compatibility check timed out',
        'The configured endpoint did not answer the compatibility request within 30 seconds.',
        'Confirm the service is running and responsive, then test the route again.',
        'settings',
        true,
        504
      ));
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
};

const describeEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return value.trim();
  }
};

const normalizeEndpointBase = (rawUrl: string, protocol: EndpointProtocol, stage: WorkflowStage): string => {
  const trimmed = rawUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TranscriptionWorkflowError(buildWorkflowError(
      stage,
      'INVALID_URL',
      'Endpoint URL is invalid',
      trimmed ? `“${trimmed}” is not a complete HTTP endpoint.` : 'An endpoint URL is required.',
      'Enter a full http:// or https:// URL in Expert settings.',
      'settings',
      false
    ));
  }

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new TranscriptionWorkflowError(buildWorkflowError(
      stage,
      'INVALID_URL',
      'Endpoint URL is not supported',
      'Processing endpoints must use HTTP or HTTPS and cannot contain embedded credentials.',
      'Remove credentials from the URL and use the API key field instead.',
      'settings',
      false
    ));
  }

  url.search = '';
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  const knownSuffixes = protocol === 'ollama'
    ? ['/api/tags', '/api/generate', '/v1']
    : ['/chat/completions', '/audio/transcriptions', '/models'];
  for (const suffix of knownSuffixes) {
    if (pathname.endsWith(suffix)) pathname = pathname.slice(0, -suffix.length);
  }
  pathname = pathname.replace(/\/+$/, '');
  if (protocol === 'openai' && !pathname.endsWith('/v1')) pathname = `${pathname}/v1`;
  url.pathname = pathname || (protocol === 'openai' ? '/v1' : '/');
  return url.toString().replace(/\/$/, '');
};

const resolveLlmEndpoint = (config: LocalConfig): EndpointDescriptor => {
  const protocol: EndpointProtocol = config.engineType === 'ollama' ? 'ollama' : 'openai';
  const baseUrl = normalizeEndpointBase(config.baseUrl || '', protocol, 'preflight');
  return protocol === 'ollama'
    ? { protocol, baseUrl, modelsUrl: `${baseUrl}/api/tags`, inferenceUrl: `${baseUrl}/api/generate` }
    : { protocol, baseUrl, modelsUrl: `${baseUrl}/models`, inferenceUrl: `${baseUrl}/chat/completions` };
};

const resolveSttEndpoint = (config: LocalConfig): EndpointDescriptor => {
  const baseUrl = normalizeEndpointBase(config.sttUrl || '', 'openai', 'preflight');
  return {
    protocol: 'openai',
    baseUrl,
    modelsUrl: `${baseUrl}/models`,
    inferenceUrl: `${baseUrl}/audio/transcriptions`
  };
};

// Execute directly first, then relay JSON-compatible requests through the app server when browser CORS blocks them.
async function requestWithProxyFallback(url: string, options: RequestInit = {}): Promise<RequestResult> {
  try {
    const response = await fetch(url, options);
    return { response, transport: 'direct' };
  } catch (directErr) {
    if (options.signal?.aborted || isAbortError(directErr)) throw createAbortError();
    console.warn(`Direct fetch to ${url} failed (likely CORS/network). Retrying through /api/local-proxy...`, directErr);
    
    // Attempt relay via server proxy
    const proxyRes = await fetch("/api/local-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        targetUrl: url,
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body
      })
    });

    return { response: proxyRes, transport: 'server-proxy' };
  }
}

async function fetchWithProxyFallback(url: string, options: RequestInit = {}): Promise<Response> {
  return (await requestWithProxyFallback(url, options)).response;
}

// Helper to fetch loaded model names dynamically from vLLM, Ollama, LM Studio, or OpenAI compatible endpoints
export async function fetchLocalModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const sanitizedUrl = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (apiKey && apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const modelNames: Set<string> = new Set();

  // 1. Try OpenAI / vLLM models endpoint (/v1/models)
  try {
    const v1ModelsUrl = sanitizedUrl.endsWith("/v1") ? `${sanitizedUrl}/models` : `${sanitizedUrl}/v1/models`;
    const res = await fetchWithProxyFallback(v1ModelsUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.data)) {
        data.data.forEach((m: any) => {
          if (m.id) modelNames.add(m.id);
        });
      }
    }
  } catch (err) {
    console.warn("Failed fetching from /v1/models:", err);
  }

  // 2. Try Ollama native tags endpoint (/api/tags)
  try {
    const ollamaTagsUrl = sanitizedUrl.endsWith("/v1")
      ? `${sanitizedUrl.replace(/\/v1$/, "")}/api/tags`
      : `${sanitizedUrl}/api/tags`;
    const res = await fetchWithProxyFallback(ollamaTagsUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.models)) {
        data.models.forEach((m: any) => {
          if (m.name) modelNames.add(m.name);
          if (m.model) modelNames.add(m.model);
        });
      }
    }
  } catch (err) {
    console.warn("Failed fetching from /api/tags:", err);
  }

  return Array.from(modelNames);
}

// Call the exact inference route verified by preflight.
async function callLocalLLM(
  config: LocalConfig,
  userPrompt: string,
  signal?: AbortSignal
): Promise<string> {
  const descriptor = resolveLlmEndpoint(config);
  const model = config.llmModel.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey && config.apiKey.trim()) {
    headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;
  }
  throwIfAborted(signal);
  const body = descriptor.protocol === 'ollama'
    ? { model, prompt: userPrompt, stream: false }
    : {
        model,
        messages: [{ role: "user", content: userPrompt }],
        temperature: 0.3
      };
  console.log(`Calling ${descriptor.protocol} inference endpoint: ${descriptor.inferenceUrl} with model '${model}'...`);
  const response = await fetchWithProxyFallback(descriptor.inferenceUrl, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await readResponseDetail(response);
    const issue = issueForHttpStatus(response, 'refinement', 'Language model', detail);
    issue.target = 'llm';
    throw new TranscriptionWorkflowError(issue);
  }

  const data = await response.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.response || (typeof data === 'string' ? data : '');
  if (!String(text).trim()) {
    throw new TranscriptionWorkflowError(buildWorkflowError('refinement', 'EMPTY_RESULT', 'Language model returned no text', 'The refinement endpoint answered successfully but did not include transcript content.', 'Check the selected model and its chat compatibility, then retry refinement.', 'settings', true));
  }
  return String(text);
}


// Helper to fetch loaded STT model names dynamically from local Whisper, vLLM, or Groq endpoints
export async function fetchLocalSTTModels(sttUrl: string, apiKey?: string): Promise<string[]> {
  const sanitizedUrl = sttUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (apiKey && apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const modelNames: Set<string> = new Set();

  // 1. Try OpenAI / vLLM / Whisper models endpoint (/v1/models)
  try {
    const v1ModelsUrl = sanitizedUrl.endsWith("/v1") ? `${sanitizedUrl}/models` : `${sanitizedUrl}/v1/models`;
    const res = await fetchWithProxyFallback(v1ModelsUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.data)) {
        data.data.forEach((m: any) => {
          if (m.id) modelNames.add(m.id);
        });
      }
    }
  } catch (err) {
    console.warn("Failed fetching STT models from /v1/models:", err);
  }

  // 2. Try Ollama tags endpoint (/api/tags)
  try {
    const ollamaTagsUrl = sanitizedUrl.endsWith("/v1")
      ? `${sanitizedUrl.replace(/\/v1$/, "")}/api/tags`
      : `${sanitizedUrl}/api/tags`;
    const res = await fetchWithProxyFallback(ollamaTagsUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.models)) {
        data.models.forEach((m: any) => {
          if (m.name) modelNames.add(m.name);
          if (m.model) modelNames.add(m.model);
        });
      }
    }
  } catch (err) {
    console.warn("Failed fetching STT models from /api/tags:", err);
  }

  return Array.from(modelNames);
}

const readResponseDetail = async (response: Response) => {
  const text = await response.text().catch(() => '');
  if (!text) return response.statusText;
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.error || parsed.message || text;
  } catch {
    return text;
  }
};

const issueForHttpStatus = (
  response: Response,
  stage: WorkflowStage,
  label: string,
  detail?: unknown
) => {
  const endpoint = describeEndpoint(response.url || label);
  if (response.status === 401 || response.status === 403) {
    return buildWorkflowError(stage, 'AUTH_FAILED', `${label} rejected its credentials`, `Authentication failed at ${endpoint}.`, 'Review the API key in Expert settings.', 'settings', false, response.status, detail);
  }
  if (response.status === 404 || response.status === 405) {
    return buildWorkflowError(stage, 'ENDPOINT_NOT_FOUND', `${label} route was not found`, `The configured server responded, but not at the expected API path.`, 'Check the base URL and engine type in Expert settings.', 'settings', false, response.status, detail);
  }
  if (response.status === 429) {
    return buildWorkflowError(stage, 'RATE_LIMITED', `${label} is rate limited`, 'The service is temporarily limiting compatibility requests.', 'Wait briefly, then test the route again.', 'retry', true, response.status, detail);
  }
  if (response.status === 413) {
    return buildWorkflowError(stage, 'INVALID_FILE', 'Media file is too large', 'The endpoint rejected the request size.', 'Choose a smaller supported file, then try again.', 'file', false, response.status, detail);
  }
  if (response.status === 415 || response.status === 422) {
    return buildWorkflowError(stage, 'INVALID_FILE', 'Media file was rejected', 'The endpoint could not process this file or request format.', 'Choose another supported media file or review the selected speech model.', 'file', false, response.status, detail);
  }
  if (response.status >= 500) {
    return buildWorkflowError(stage, 'SERVICE_UNAVAILABLE', `${label} is unavailable`, `The endpoint responded with status ${response.status}.`, 'Check the service logs, then retry.', 'retry', true, response.status, detail);
  }
  return buildWorkflowError(stage, 'INCOMPATIBLE_RESPONSE', `${label} rejected the compatibility check`, `The endpoint responded with status ${response.status}.`, 'Review the endpoint and selected model in Expert settings.', 'settings', false, response.status, detail);
};

const parseAdvertisedModels = (payload: any, protocol: EndpointProtocol) => {
  const models = new Set<string>();
  if (protocol === 'ollama' && Array.isArray(payload?.models)) {
    payload.models.forEach((model: any) => {
      if (typeof model?.name === 'string') models.add(model.name);
      if (typeof model?.model === 'string') models.add(model.model);
    });
  }
  if (Array.isArray(payload?.data)) {
    payload.data.forEach((model: any) => {
      if (typeof model?.id === 'string') models.add(model.id);
    });
  }
  return Array.from(models);
};

const modelIsAdvertised = (configuredModel: string, models: string[], protocol: EndpointProtocol) => {
  if (models.includes(configuredModel)) return true;
  if (protocol !== 'ollama') return false;
  const configuredBase = configuredModel.replace(/:latest$/, '');
  return models.some(model => model.replace(/:latest$/, '') === configuredBase);
};

const checkCloudCompatibility = async (signal?: AbortSignal): Promise<CompatibilityCheck> => {
  try {
    const response = await withPreflightTimeout(signal, timeoutSignal => (
      fetch('/api/preflight/gemini', { signal: timeoutSignal, cache: 'no-store' })
    ));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = buildWorkflowError(
        'preflight',
        payload.code === 'AUTH_FAILED' ? 'AUTH_FAILED' : response.status === 503 ? 'SERVICE_UNAVAILABLE' : 'INCOMPATIBLE_RESPONSE',
        payload.title || 'Gemini route is not ready',
        payload.error || 'The app server could not verify the configured Gemini model.',
        payload.suggestion || 'Check the server API key and Gemini model availability, then test again.',
        payload.action === 'review_settings' ? 'settings' : 'retry',
        payload.retryable ?? response.status >= 500,
        response.status,
        payload.detail
      );
      return { target: 'cloud', label: 'Gemini Cloud', status: 'fail', detail: error.message, error };
    }
    return {
      target: 'cloud',
      label: 'Gemini Cloud',
      status: 'pass',
      detail: `Server credentials and ${payload.model || 'the configured Gemini model'} are available.`,
      model: payload.model
    };
  } catch (error) {
    if (isAbortError(error)) throw createAbortError();
    const issue = normalizeTranscriptionError(error, 'preflight');
    return { target: 'cloud', label: 'Gemini Cloud', status: 'fail', detail: issue.message, error: issue };
  }
};

const checkLlmCompatibility = async (config: LocalConfig, signal?: AbortSignal): Promise<CompatibilityCheck> => {
  const model = config.llmModel?.trim();
  if (!model) {
    const error = buildWorkflowError('preflight', 'MISSING_CONFIGURATION', 'Language model is required', 'No refinement model is selected.', 'Enter or discover a loaded language model in Expert settings.', 'settings', false);
    return { target: 'llm', label: 'Language model', status: 'fail', detail: error.message, error };
  }

  let descriptor: EndpointDescriptor;
  try {
    descriptor = resolveLlmEndpoint(config);
  } catch (error) {
    const issue = normalizeTranscriptionError(error, 'preflight');
    return { target: 'llm', label: 'Language model', status: 'fail', detail: issue.message, model, error: issue };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  let advertisedModels: string[] = [];
  let inventoryWarning = '';
  let transport: EndpointTransport = 'direct';

  try {
    const inventory = await withPreflightTimeout(signal, timeoutSignal => (
      requestWithProxyFallback(descriptor.modelsUrl, { headers, signal: timeoutSignal })
    ));
    transport = inventory.transport;
    if (inventory.response.ok) {
      const payload = await inventory.response.json().catch(() => null);
      advertisedModels = parseAdvertisedModels(payload, descriptor.protocol);
      if (advertisedModels.length > 0 && !modelIsAdvertised(model, advertisedModels, descriptor.protocol)) {
        const availablePreview = advertisedModels.slice(0, 4).join(', ');
        const error = buildWorkflowError('preflight', 'MODEL_NOT_FOUND', `Model “${model}” is not loaded`, `${describeEndpoint(descriptor.modelsUrl)} advertised ${advertisedModels.length} other model${advertisedModels.length === 1 ? '' : 's'}.`, `Select a discovered model${availablePreview ? ` such as ${availablePreview}` : ''}, then test again.`, 'settings', false, 409);
        return { target: 'llm', label: 'Language model', status: 'fail', detail: error.message, endpoint: describeEndpoint(descriptor.inferenceUrl), model, discoveredModels: advertisedModels, error };
      }
      if (advertisedModels.length === 0) inventoryWarning = 'The server returned no model inventory; inference was tested directly.';
    } else if ([404, 405].includes(inventory.response.status)) {
      inventoryWarning = 'This server does not expose model discovery; inference was tested directly.';
    } else {
      const detail = await readResponseDetail(inventory.response);
      const error = issueForHttpStatus(inventory.response, 'preflight', 'Language model endpoint', detail);
      return { target: 'llm', label: 'Language model', status: 'fail', detail: error.message, endpoint: describeEndpoint(descriptor.modelsUrl), model, error };
    }
  } catch (error) {
    if (isAbortError(error)) throw createAbortError();
    const issue = normalizeTranscriptionError(error, 'preflight');
    return { target: 'llm', label: 'Language model', status: 'fail', detail: issue.message, endpoint: describeEndpoint(descriptor.modelsUrl), model, error: issue };
  }

  try {
    const body = descriptor.protocol === 'ollama'
      ? { model, prompt: 'Reply with OK.', stream: false, options: { num_predict: 1 } }
      : { model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 1, temperature: 0 };
    const probe = await withPreflightTimeout(signal, timeoutSignal => (
      requestWithProxyFallback(descriptor.inferenceUrl, {
        method: 'POST',
        headers,
        signal: timeoutSignal,
        body: JSON.stringify(body)
      })
    ));
    transport = probe.transport;
    if (!probe.response.ok) {
      const detail = await readResponseDetail(probe.response);
      const error = issueForHttpStatus(probe.response, 'preflight', 'Language model inference', detail);
      if (/model/i.test(String(detail)) && [400, 404, 422].includes(probe.response.status)) {
        error.code = 'MODEL_NOT_FOUND';
        error.title = `Model “${model}” could not run`;
        error.suggestion = 'Choose a model that supports chat or text generation, then test again.';
      }
      return { target: 'llm', label: 'Language model', status: 'fail', detail: error.message, endpoint: describeEndpoint(descriptor.inferenceUrl), model, discoveredModels: advertisedModels, error };
    }
    const probePayload = await probe.response.json().catch(() => null);
    const probeText = probePayload?.choices?.[0]?.message?.content
      || probePayload?.choices?.[0]?.text
      || probePayload?.response
      || (typeof probePayload === 'string' ? probePayload : '');
    if (!String(probeText).trim()) {
      const error = buildWorkflowError(
        'preflight',
        'INCOMPATIBLE_RESPONSE',
        'Language model returned an incompatible response',
        'The inference route answered successfully but did not return text in the configured API format.',
        'Check the engine type and choose a chat or text-generation model, then test again.',
        'settings',
        false,
        probe.response.status
      );
      return {
        target: 'llm',
        label: 'Language model',
        status: 'fail',
        detail: error.message,
        endpoint: describeEndpoint(descriptor.inferenceUrl),
        model,
        discoveredModels: advertisedModels,
        error
      };
    }
    return {
      target: 'llm',
      label: 'Language model',
      status: inventoryWarning ? 'warning' : 'pass',
      detail: inventoryWarning || `${model} answered a minimal inference check${transport === 'server-proxy' ? ' through the server relay' : ''}.`,
      endpoint: describeEndpoint(descriptor.inferenceUrl),
      model,
      discoveredModels: advertisedModels
    };
  } catch (error) {
    if (isAbortError(error)) throw createAbortError();
    const issue = normalizeTranscriptionError(error, 'preflight');
    return { target: 'llm', label: 'Language model', status: 'fail', detail: issue.message, endpoint: describeEndpoint(descriptor.inferenceUrl), model, discoveredModels: advertisedModels, error: issue };
  }
};

const checkSttCompatibility = async (config: LocalConfig, signal?: AbortSignal): Promise<CompatibilityCheck> => {
  const model = config.sttModel?.trim();
  if (!model) {
    const error = buildWorkflowError('preflight', 'MISSING_CONFIGURATION', 'Speech model is required', 'No speech-to-text model is selected.', 'Enter or discover a speech model in Expert settings.', 'settings', false);
    return { target: 'stt', label: 'Speech recognition', status: 'fail', detail: error.message, error };
  }
  if (config.sttEngine === 'groq_stt' && !(config.sttApiKey || config.apiKey)?.trim()) {
    const error = buildWorkflowError('preflight', 'AUTH_FAILED', 'Groq API key is required', 'Groq Cloud STT cannot be tested without credentials.', 'Add the Groq API key in Expert settings.', 'settings', false);
    return { target: 'stt', label: 'Speech recognition', status: 'fail', detail: error.message, model, error };
  }
  if (config.sttEngine === 'ollama_stt') {
    const error = buildWorkflowError('preflight', 'ENDPOINT_NOT_FOUND', 'Ollama STT route is incompatible', 'Native Ollama does not expose the OpenAI-compatible /audio/transcriptions route this workflow requires.', 'Choose Faster-Whisper, vLLM Audio, Groq STT, or a Custom STT endpoint.', 'settings', false);
    return { target: 'stt', label: 'Speech recognition', status: 'fail', detail: error.message, model, error };
  }

  let descriptor: EndpointDescriptor;
  try {
    descriptor = resolveSttEndpoint(config);
  } catch (error) {
    const issue = normalizeTranscriptionError(error, 'preflight');
    return { target: 'stt', label: 'Speech recognition', status: 'fail', detail: issue.message, model, error: issue };
  }
  const headers: Record<string, string> = {};
  const apiKey = config.sttApiKey || config.apiKey;
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  try {
    const inventory = await withPreflightTimeout(signal, timeoutSignal => (
      requestWithProxyFallback(descriptor.modelsUrl, { headers, signal: timeoutSignal })
    ));
    if (inventory.response.ok) {
      const payload = await inventory.response.json().catch(() => null);
      const models = parseAdvertisedModels(payload, 'openai');
      if (models.length > 0 && !models.includes(model)) {
        const error = buildWorkflowError('preflight', 'MODEL_NOT_FOUND', `Speech model “${model}” is not loaded`, `${describeEndpoint(descriptor.modelsUrl)} advertised ${models.length} other model${models.length === 1 ? '' : 's'}.`, `Select one of the discovered speech models, then test again.`, 'settings', false, 409);
        return { target: 'stt', label: 'Speech recognition', status: 'fail', detail: error.message, endpoint: describeEndpoint(descriptor.inferenceUrl), model, discoveredModels: models, error };
      }
      return {
        target: 'stt',
        label: 'Speech recognition',
        status: models.length > 0 ? 'pass' : 'warning',
        detail: models.length > 0
          ? `${model} is advertised by the speech endpoint. The actual media request will verify transcription support.`
          : 'The endpoint is reachable but returned no model inventory; the actual media request will verify transcription support.',
        endpoint: describeEndpoint(descriptor.inferenceUrl),
        model,
        discoveredModels: models
      };
    }
    if ([404, 405].includes(inventory.response.status)) {
      return {
        target: 'stt',
        label: 'Speech recognition',
        status: 'warning',
        detail: 'The server is reachable but does not expose model discovery. The actual media request will verify its transcription route.',
        endpoint: describeEndpoint(descriptor.inferenceUrl),
        model
      };
    }
    const detail = await readResponseDetail(inventory.response);
    const error = issueForHttpStatus(inventory.response, 'preflight', 'Speech model endpoint', detail);
    return { target: 'stt', label: 'Speech recognition', status: 'fail', detail: error.message, endpoint: describeEndpoint(descriptor.modelsUrl), model, error };
  } catch (error) {
    if (isAbortError(error)) throw createAbortError();
    const issue = normalizeTranscriptionError(error, 'preflight');
    return { target: 'stt', label: 'Speech recognition', status: 'fail', detail: issue.message, endpoint: describeEndpoint(descriptor.modelsUrl), model, error: issue };
  }
};

export const preflightTranscriptionRoute = async (
  provider: ModelProvider,
  localConfig?: LocalConfig,
  signal?: AbortSignal,
  resumeFromTranscription = false
): Promise<CompatibilityReport> => {
  throwIfAborted(signal);
  let checks: CompatibilityCheck[];
  if (provider === ModelProvider.GEMINI) {
    checks = [await checkCloudCompatibility(signal)];
  } else if (!localConfig) {
    const error = buildWorkflowError('preflight', 'MISSING_CONFIGURATION', 'Local route is not configured', 'The selected local workflow has no endpoint configuration.', 'Open Expert settings and configure the processing route.', 'settings', false);
    checks = [{ target: 'llm', label: 'Language model', status: 'fail', detail: error.message, error }];
  } else if (resumeFromTranscription) {
    checks = [await checkLlmCompatibility(localConfig, signal)];
  } else if (localConfig.transcriptionMode === TranscriptionMode.HYBRID) {
    checks = await Promise.all([checkCloudCompatibility(signal), checkLlmCompatibility(localConfig, signal)]);
  } else {
    checks = await Promise.all([checkSttCompatibility(localConfig, signal), checkLlmCompatibility(localConfig, signal)]);
  }
  throwIfAborted(signal);
  const hasFailure = checks.some(check => check.status === 'fail');
  const hasWarning = checks.some(check => check.status === 'warning');
  return {
    status: hasFailure ? 'blocked' : hasWarning ? 'warning' : 'compatible',
    summary: hasFailure
      ? 'Route needs attention before transcription.'
      : hasWarning
        ? 'Route is reachable with one runtime check remaining.'
        : 'Endpoints and selected models are ready.',
    checks,
    checkedAt: new Date().toISOString()
  };
};

interface XhrResult {
  status: number;
  responseText: string;
}

const createSttFormData = (file: File, config: LocalConfig) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', config.sttModel || 'whisper-1');
  if (config.sttLanguage && config.sttLanguage !== 'auto') formData.append('language', config.sttLanguage);
  return formData;
};

const sendXhr = (
  url: string,
  formData: FormData,
  apiKey: string | undefined,
  onProgress: ((percent: number) => void) | undefined,
  signal?: AbortSignal
) => new Promise<XhrResult>((resolve, reject) => {
  throwIfAborted(signal);
  const xhr = new XMLHttpRequest();
  const cleanup = () => signal?.removeEventListener('abort', handleAbort);
  const handleAbort = () => xhr.abort();
  signal?.addEventListener('abort', handleAbort, { once: true });
  xhr.open('POST', url);
  if (apiKey?.trim()) xhr.setRequestHeader('Authorization', `Bearer ${apiKey.trim()}`);
  if (onProgress && xhr.upload) {
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
  }
  xhr.onload = () => {
    cleanup();
    resolve({ status: xhr.status, responseText: xhr.responseText });
  };
  xhr.onerror = () => {
    cleanup();
    reject(new TypeError(`Network error connecting to ${describeEndpoint(url)}.`));
  };
  xhr.onabort = () => {
    cleanup();
    reject(createAbortError());
  };
  xhr.send(formData);
});

const parseTranscriptionResponse = (result: XhrResult) => {
  try {
    const data = JSON.parse(result.responseText);
    return String(data.text || data.transcript || '');
  } catch {
    return result.responseText;
  }
};

const sendSttThroughServer = async (
  targetUrl: string,
  config: LocalConfig,
  file: File,
  signal?: AbortSignal
) => {
  const formData = createSttFormData(file, config);
  formData.append('targetUrl', targetUrl);
  const apiKey = config.sttApiKey || config.apiKey;
  if (apiKey?.trim()) formData.append('apiKey', apiKey.trim());
  const response = await fetch('/api/local-stt-proxy', { method: 'POST', body: formData, signal });
  const responseText = await response.text();
  return { status: response.status, responseText };
};

// Call the exact OpenAI-compatible STT route verified by preflight, with a same-origin relay fallback for CORS.
async function callLocalSTT(
  config: LocalConfig,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<string> {
  const descriptor = resolveSttEndpoint(config);
  const apiKey = config.sttApiKey || config.apiKey;
  let result: XhrResult;
  console.log(`Sending audio to STT engine at ${descriptor.inferenceUrl} (model: ${config.sttModel})...`);
  try {
    result = await sendXhr(descriptor.inferenceUrl, createSttFormData(file, config), apiKey, onProgress, signal);
  } catch (error) {
    if (isAbortError(error)) throw createAbortError();
    result = await sendSttThroughServer(descriptor.inferenceUrl, config, file, signal);
  }

  if ([404, 405].includes(result.status) && descriptor.inferenceUrl.includes('/v1/')) {
    const fallbackUrl = descriptor.inferenceUrl.replace('/v1/', '/');
    try {
      result = await sendXhr(fallbackUrl, createSttFormData(file, config), apiKey, onProgress, signal);
    } catch (error) {
      if (isAbortError(error)) throw createAbortError();
      result = await sendSttThroughServer(fallbackUrl, config, file, signal);
    }
  }

  if (result.status < 200 || result.status >= 300) {
    const response = new Response(result.responseText, { status: result.status || 502 });
    const detail = safeTechnicalDetail(result.responseText);
    const issue = issueForHttpStatus(response, 'transcription', 'Speech transcription endpoint', detail);
    issue.target = 'stt';
    try {
      const payload = JSON.parse(result.responseText);
      if (typeof payload.error === 'string') issue.message = payload.error;
      if (typeof payload.suggestion === 'string') issue.suggestion = payload.suggestion;
      if (payload.action === 'review_settings') issue.recovery = 'settings';
      if (payload.action === 'retry') issue.recovery = 'retry';
      if (typeof payload.retryable === 'boolean') issue.retryable = payload.retryable;
    } catch {}
    throw new TranscriptionWorkflowError(issue);
  }
  const text = parseTranscriptionResponse(result).trim();
  if (!text) {
    throw new TranscriptionWorkflowError(buildWorkflowError('transcription', 'EMPTY_RESULT', 'Speech model returned no transcript', 'The speech endpoint accepted the media but returned no text.', 'Review the speech model and language settings, then retry.', 'settings', true));
  }
  return text;
}

const cleanupChunkUpload = async (uploadId: string) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);
  try {
    await fetch('/api/cancel-chunked-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
      keepalive: true,
      signal: controller.signal
    });
  } catch {
    // The server scavenger remains a last-resort cleanup if the browser is already offline.
  } finally {
    window.clearTimeout(timeoutId);
  }
};

// Helper to upload a file in small 4MB chunks with an adaptive retry mechanism to bypass Cloud Run / GFE 32MB payload limit
async function uploadFileInChunks(
  file: File,
  isRawOnly: boolean,
  onProgress: (percent: number) => void,
  onStatusUpdate: (msg: string) => void,
  customTerms?: string[],
  signal?: AbortSignal
): Promise<string> {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks balance proxy compatibility, payload boundaries, and network speed
  const fileSize = file?.size ?? 0;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  const uploadId = `${Math.random().toString(36).substring(2, 11)}-${Date.now().toString(36)}`;

  try {
  
  onStatusUpdate(`Initializing file transmission in ${totalChunks} secure chunks...`);
  
  for (let i = 0; i < totalChunks; i++) {
    throwIfAborted(signal);
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileSize);
    const chunkBlob = file.slice(start, end);
    
    // Exponential retry loop for each chunk (extended to 6 attempts)
    const maxRetries = 6;
    let attempt = 0;
    let success = false;
    let lastError: Error | null = null;
    
    while (attempt < maxRetries && !success) {
      const controller = new AbortController();
      const handleExternalAbort = () => controller.abort();
      signal?.addEventListener('abort', handleExternalAbort, { once: true });
      // Set absolute 5 minutes timeout for sending a file chunk (robust for all connection types)
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt) * 1000 + (Math.random() * 500); // add a little jitter
          onStatusUpdate(`Fragment ${i + 1} send failed. Retrying (attempt ${attempt + 1}/${maxRetries}) in ${(delay / 1000).toFixed(1)}s...`);
          await abortableDelay(delay, signal);
        } else {
          onStatusUpdate(`Uploading audio fragment ${i + 1} of ${totalChunks}...`);
        }
        
        const formData = new FormData();
        formData.append("file", chunkBlob, file.name);
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", String(i));
        formData.append("totalChunks", String(totalChunks));
        formData.append("fileName", file.name);
        
        const response = await fetch("/api/upload-chunk", {
          method: "POST",
          body: formData,
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', handleExternalAbort);

        if (response.ok) {
          success = true;
          // Calculate progressive visual updates slice-by-slice
          const prevProgress = ((i + 1) / totalChunks) * 100;
          onProgress(Math.min(99, Math.round(prevProgress)));
        } else {
          const responseText = await response.text();
          throw new TranscriptionWorkflowError(issueFromAppResponse(response.status, responseText, 'upload'));
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', handleExternalAbort);
        if (signal?.aborted) throw createAbortError();
        if (err instanceof TranscriptionWorkflowError && !err.info.retryable) {
          throw err;
        }
        if (isAbortError(err)) {
          lastError = new Error("Connection timed out while sending the audio fragment.");
        } else {
          lastError = err || new Error("Network connection lost during chunk transmission. This can sometimes occur due to proxy or network restrictions.");
        }
        attempt++;
      }
    }
    
    if (!success) {
      throw lastError || new Error(`Failed to transmit fragment ${i + 1} after ${maxRetries} attempts.`);
    }

    // Gentle socket settlement delay of 250ms after successful transmission to avoid overloading connection pool / gateway
    if (i < totalChunks - 1) {
      await abortableDelay(250, signal);
    }
  }
  
  onStatusUpdate("Consolidating streams copy & launching Gemini transcriber...");
  onProgress(100);
  
  return await new Promise<string>((resolve, reject) => {
    throwIfAborted(signal);
    const xhr = new XMLHttpRequest();
    const handleAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', handleAbort);
    signal?.addEventListener('abort', handleAbort, { once: true });
    xhr.open("POST", "/api/transcribe-chunked");
    xhr.setRequestHeader("Content-Type", "application/json");
    
    xhr.onload = () => {
      cleanup();
      let responseData;
      try {
        responseData = JSON.parse(xhr.responseText);
      } catch (err) {
        const rawPreview = xhr.responseText ? xhr.responseText.substring(0, 300) : "Empty response";
        responseData = { error: `An invalid server response was received (Status ${xhr.status}): ${rawPreview}` };
      }
      
      if (xhr.status >= 200 && xhr.status < 300) {
        const text = String(responseData.text || '').trim();
        if (!text) {
          reject(new TranscriptionWorkflowError(buildWorkflowError(
            isRawOnly ? 'transcription' : 'upload',
            'EMPTY_RESULT',
            'Transcription service returned no text',
            'The server completed without a usable transcript.',
            'Retry the request. If it repeats, review the configured model.',
            'retry',
            true,
            xhr.status,
            responseData.error
          )));
          return;
        }
        resolve(text);
      } else {
        reject(new TranscriptionWorkflowError(issueFromAppResponse(
          xhr.status,
          xhr.responseText,
          isRawOnly ? 'transcription' : 'upload'
        )));
      }
    };
    
    xhr.onerror = () => {
      cleanup();
      reject(new TypeError("A network error occurred while running chunked transcription."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(createAbortError());
    };
    
    xhr.send(JSON.stringify({
      uploadId,
      fileName: file.name,
      totalChunks,
      rawOnly: isRawOnly,
      customTerms
    }));
  });
  } finally {
    await cleanupChunkUpload(uploadId);
  }
}

const issueFromAppResponse = (
  status: number,
  responseText: string,
  stage: WorkflowStage
) => {
  let payload: any = {};
  try { payload = JSON.parse(responseText); } catch {}
  const response = new Response(responseText, { status: status || 502 });
  const issue = issueForHttpStatus(response, stage, 'Transcription server', payload.detail || responseText);
  if (typeof payload.error === 'string') issue.message = payload.error;
  if (typeof payload.suggestion === 'string') issue.suggestion = payload.suggestion;
  if (payload.action === 'retry' || payload.action === 'restart_upload') issue.recovery = 'retry';
  if (payload.action === 'settings' || payload.action === 'review_settings') issue.recovery = 'settings';
  if (payload.action === 'file' || payload.action === 'choose_another_file') issue.recovery = 'file';
  if (typeof payload.retryable === 'boolean') issue.retryable = payload.retryable;
  if (payload.code === 'FILE_TOO_LARGE' || payload.code === 'EMPTY_FILE' || payload.code === 'UNSUPPORTED_MEDIA_TYPE') {
    issue.code = 'INVALID_FILE';
    issue.title = payload.code === 'FILE_TOO_LARGE' ? 'Media file is too large' : 'Media file was rejected';
    issue.recovery = 'file';
  }
  return issue;
};

const sendCloudTranscription = (
  file: File,
  rawOnly: boolean,
  customTerms: string[] | undefined,
  onProgress: ((percent: number) => void) | undefined,
  signal?: AbortSignal
) => new Promise<string>((resolve, reject) => {
  throwIfAborted(signal);
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  formData.append('file', file);
  if (rawOnly) formData.append('rawOnly', 'true');
  if (customTerms?.length) formData.append('customTerms', JSON.stringify(customTerms));
  const handleAbort = () => xhr.abort();
  const cleanup = () => signal?.removeEventListener('abort', handleAbort);
  signal?.addEventListener('abort', handleAbort, { once: true });
  xhr.open('POST', '/api/transcribe');
  if (onProgress && xhr.upload) {
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
  }
  xhr.onload = () => {
    cleanup();
    if (xhr.status < 200 || xhr.status >= 300) {
      reject(new TranscriptionWorkflowError(issueFromAppResponse(xhr.status, xhr.responseText, rawOnly ? 'transcription' : 'upload')));
      return;
    }
    try {
      const payload = JSON.parse(xhr.responseText);
      const text = String(payload.text || '').trim();
      if (!text) {
        reject(new TranscriptionWorkflowError(buildWorkflowError(rawOnly ? 'transcription' : 'upload', 'EMPTY_RESULT', 'Transcription service returned no text', 'The server completed without a transcript.', 'Retry the request. If it repeats, review the selected model.', 'retry', true)));
        return;
      }
      resolve(text);
    } catch {
      reject(new TranscriptionWorkflowError(buildWorkflowError(rawOnly ? 'transcription' : 'upload', 'INCOMPATIBLE_RESPONSE', 'Transcription server returned an invalid response', 'The server response could not be read as transcript data.', 'Check the server logs, then retry.', 'retry', true, xhr.status, xhr.responseText)));
    }
  };
  xhr.onerror = () => {
    cleanup();
    reject(new TypeError('Network error while uploading to the transcription server.'));
  };
  xhr.onabort = () => {
    cleanup();
    reject(createAbortError());
  };
  xhr.send(formData);
});

// Main transcription runner. Its immutable request snapshot can be canceled without discarding selected work.
export const transcribeAudio = async (
  request: TranscriptionRequest,
  callbacks: TranscriptionCallbacks = {}
): Promise<string> => {
  const { file, provider, localConfig, customTerms, signal, resumeTranscript } = request;
  const { onProgress, onStatusUpdate, onStageResult } = callbacks;
  let activeFile = file;
  let currentStage: WorkflowStage = 'optimization';

  try {
    throwIfAborted(signal);
    const needsOptimization = !resumeTranscript && (
      provider === ModelProvider.GEMINI ||
      (provider === ModelProvider.LOCAL && localConfig?.transcriptionMode === TranscriptionMode.HYBRID)
    );
    if (needsOptimization) {
      try {
        const { optimizeMediaFile } = await import('./audioProcessor');
        activeFile = await optimizeMediaFile(file, message => onStatusUpdate?.(message), signal);
        throwIfAborted(signal);
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw createAbortError();
        console.warn('Client-side audio optimization failed; proceeding with the original file:', error);
        onStatusUpdate?.('Local extraction was unavailable; using the original media file.');
      }
    }

    if (provider === ModelProvider.GEMINI) {
      currentStage = 'upload';
      onStatusUpdate?.('Uploading media to Gemini Cloud...');
      const result = activeFile.size > 10 * 1024 * 1024
        ? await uploadFileInChunks(activeFile, false, onProgress || (() => {}), onStatusUpdate || (() => {}), customTerms, signal)
        : await sendCloudTranscription(activeFile, false, customTerms, onProgress, signal);
      if (!result.trim()) throw new TranscriptionWorkflowError(buildWorkflowError('transcription', 'EMPTY_RESULT', 'No transcript was generated', 'The service completed without usable text.', 'Retry the transcription. If it repeats, review the selected model.', 'retry', true));
      return result;
    }

    if (!localConfig) {
      throw new TranscriptionWorkflowError(buildWorkflowError('preflight', 'MISSING_CONFIGURATION', 'Local route is not configured', 'The local processing route is missing its configuration.', 'Open Expert settings and configure the route.', 'settings', false));
    }

    let transcriptText = resumeTranscript?.trim() || '';
    if (transcriptText) {
      onStatusUpdate?.('Reusing the recovered raw transcript; retrying refinement only...');
      onStageResult?.('transcription', transcriptText);
    } else if (localConfig.transcriptionMode === TranscriptionMode.HYBRID) {
      currentStage = 'transcription';
      onStatusUpdate?.('Gemini Cloud is creating the raw transcript...');
      transcriptText = activeFile.size > 10 * 1024 * 1024
        ? await uploadFileInChunks(activeFile, true, onProgress || (() => {}), onStatusUpdate || (() => {}), customTerms, signal)
        : await sendCloudTranscription(activeFile, true, customTerms, onProgress, signal);
      onStageResult?.('transcription', transcriptText);
    } else {
      currentStage = 'transcription';
      onStatusUpdate?.(`Transcribing with ${localConfig.sttModel || 'the selected speech model'}...`);
      transcriptText = await callLocalSTT(localConfig, activeFile, onProgress, signal);
      onStageResult?.('transcription', transcriptText);
    }

    throwIfAborted(signal);
    currentStage = 'refinement';
    onStatusUpdate?.(`Refining the recovered transcript with ${localConfig.llmModel}...`);
    const vocabularyHint = customTerms?.length
      ? `\nSpecial vocabulary terms to correct spelling or phonetic voice-recognition errors:\n${customTerms.map(term => `- ${term}`).join('\n')}\n`
      : '';
    const refinementPrompt = `Attached below is a transcription of an audio/video file.
Please reorganize, structure, and refine it to create a professional transcript output.
${vocabularyHint}
Execute the following steps:
1. Provide a brief, professional description or summary of its content at the top, titled "## Content Description".
2. Create a refined, formatted transcript section titled "## Refined Transcript".
3. Identify and label multiple speakers as "Speaker 1", "Speaker 2", etc. if there are distinct voices, creating clean line breaks with speaker changes.
4. Correct obvious voice-recognition spelling or phonetic mistakes in names, tech terms, etc.

Transcription source material:
-----------------------------
${transcriptText}
-----------------------------
`;
    return await callLocalLLM(localConfig, refinementPrompt, signal);
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw createAbortError();
    if (error instanceof TranscriptionWorkflowError) throw error;
    throw new TranscriptionWorkflowError(normalizeTranscriptionError(error, currentStage));
  }
};
