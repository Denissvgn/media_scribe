import assert from 'node:assert/strict';
import test from 'node:test';
import {
  preflightTranscriptionRoute,
  transcribeAudio,
  TranscriptionWorkflowError
} from '../services/geminiService';
import {
  LocalConfig,
  ModelProvider,
  TranscriptionMode
} from '../types';

const localConfig: LocalConfig = {
  baseUrl: 'http://model.internal:8000',
  llmModel: 'refiner',
  transcriptionMode: TranscriptionMode.LOCAL_STT,
  sttUrl: 'http://speech.internal:1234',
  sttModel: 'whisper',
  engineType: 'vllm',
  sttEngine: 'faster_whisper'
};

test('proxy failures retain the configured language-model endpoint', async t => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;
  const originalWarn = console.warn;
  const requests: string[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;
  });

  (globalThis as any).window = globalThis;
  console.warn = () => undefined;
  globalThis.fetch = (async input => {
    const requestUrl = String(input);
    requests.push(requestUrl);
    if (requestUrl !== '/api/local-proxy') throw new TypeError('Direct request blocked');

    const response = new Response('unauthorized', { status: 401 });
    Object.defineProperty(response, 'url', { value: 'http://localhost/api/local-proxy' });
    return response;
  }) as typeof fetch;

  const report = await preflightTranscriptionRoute(ModelProvider.LOCAL, localConfig, undefined, true);
  const error = report.checks[0]?.error;

  assert.deepEqual(requests, [
    'http://model.internal:8000/v1/models',
    '/api/local-proxy'
  ]);
  assert.equal(error?.code, 'AUTH_FAILED');
  assert.equal(error?.message, 'Authentication failed at http://model.internal:8000/v1/models.');
  assert.doesNotMatch(error?.message || '', /local-proxy/);
});

test('speech fallback failures report the URL actually attempted', async t => {
  const originalXhr = globalThis.XMLHttpRequest;
  const originalLog = console.log;
  const attemptedUrls: string[] = [];

  class FakeXMLHttpRequest {
    status = 0;
    responseText = '';
    upload = {};
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private requestUrl = '';

    open(_method: string, url: string) {
      this.requestUrl = url;
      attemptedUrls.push(url);
    }

    setRequestHeader() {}

    send() {
      this.status = this.requestUrl.includes('/v1/') ? 404 : 401;
      this.responseText = 'unauthorized';
      queueMicrotask(() => this.onload?.());
    }

    abort() {
      this.onabort?.();
    }
  }

  (globalThis as any).XMLHttpRequest = FakeXMLHttpRequest;
  console.log = () => undefined;
  t.after(() => {
    globalThis.XMLHttpRequest = originalXhr;
    console.log = originalLog;
  });

  await assert.rejects(
    transcribeAudio({
      file: new File(['audio'], 'sample.wav', { type: 'audio/wav' }),
      provider: ModelProvider.LOCAL,
      localConfig
    }),
    error => {
      assert.ok(error instanceof TranscriptionWorkflowError);
      assert.equal(error.info.code, 'AUTH_FAILED');
      assert.equal(error.info.target, 'stt');
      assert.equal(error.info.message, 'Authentication failed at http://speech.internal:1234/audio/transcriptions.');
      return true;
    }
  );

  assert.deepEqual(attemptedUrls, [
    'http://speech.internal:1234/v1/audio/transcriptions',
    'http://speech.internal:1234/audio/transcriptions'
  ]);
});
