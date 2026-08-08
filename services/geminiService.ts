import { ModelProvider, TranscriptionMode, LocalConfig } from "../types";

// Helper function to execute request directly or fallback to /api/local-proxy if browser CORS blocks connection
async function fetchWithProxyFallback(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    const res = await fetch(url, options);
    return res;
  } catch (directErr) {
    console.warn(`Direct fetch to ${url} failed (likely CORS/network). Retrying through /api/local-proxy...`, directErr);
    
    // Attempt relay via server proxy
    const proxyRes = await fetch("/api/local-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUrl: url,
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body
      })
    });

    if (!proxyRes.ok) {
      const errorData = await proxyRes.json().catch(() => ({ error: proxyRes.statusText }));
      throw new Error(errorData.error || `Local proxy failed with status ${proxyRes.status}`);
    }

    return proxyRes;
  }
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

// Helper to call Local LLMs (vLLM, Gemma, GPT-OSS, Ollama, LM Studio, or OpenAI-Compatible) with fallback
async function callLocalLLM(
  baseUrl: string, 
  model: string, 
  userPrompt: string, 
  apiKey?: string, 
  engineType?: string
): Promise<string> {
  const sanitizedUrl = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey && apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }
  
  // Try Ollama native endpoint first (/api/generate) if explicitly ollama or port 11434
  if (engineType === 'ollama' || (sanitizedUrl.includes("11434") && engineType !== 'vllm' && engineType !== 'custom')) {
    try {
      const ollamaEndpoint = sanitizedUrl.endsWith("/v1")
        ? `${sanitizedUrl.replace(/\/v1$/, "")}/api/generate`
        : `${sanitizedUrl}/api/generate`;

      console.log(`Calling native Ollama /api/generate at ${ollamaEndpoint}...`);
      const response = await fetchWithProxyFallback(ollamaEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          prompt: userPrompt,
          stream: false
        })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.response) return data.response;
      }
    } catch (err) {
      console.warn("Native Ollama generate call failed, falling back to OpenAI v1 endpoint...", err);
    }
  }

  // vLLM / Standard OpenAI-compatible endpoint (/v1/chat/completions)
  let openAiUrl = sanitizedUrl;
  if (!openAiUrl.endsWith("/v1") && !openAiUrl.endsWith("/chat/completions")) {
    openAiUrl = `${openAiUrl}/v1/chat/completions`;
  } else if (openAiUrl.endsWith("/v1")) {
    openAiUrl = `${openAiUrl}/chat/completions`;
  }

  console.log(`Calling OpenAI / vLLM compatible endpoint: ${openAiUrl} with model '${model}'...`);
  const response = await fetchWithProxyFallback(openAiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Local model server (${engineType || 'vLLM/OpenAI'}) error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.response || (typeof data === 'string' ? data : JSON.stringify(data));
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

// Helper to call Local Whisper / Audio STT API (/v1/audio/transcriptions)
async function callLocalSTT(
  sttUrl: string, 
  model: string, 
  file: File, 
  onProgress?: (percent: number) => void,
  apiKey?: string,
  language?: string
): Promise<string> {
  const sanitizedUrl = sttUrl.replace(/\/+$/, "");
  let targetUrl = sanitizedUrl.endsWith("/v1") 
    ? `${sanitizedUrl}/audio/transcriptions` 
    : `${sanitizedUrl}/v1/audio/transcriptions`;
  
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", model || "whisper-1");
  if (language && language !== "auto") {
    formData.append("language", language);
  }

  console.log(`Sending audio to local STT engine at ${targetUrl} (model: ${model})...`);
  
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", targetUrl);
    
    if (apiKey && apiKey.trim()) {
      xhr.setRequestHeader("Authorization", `Bearer ${apiKey.trim()}`);
    }
    
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data.text || data.transcript || JSON.stringify(data));
        } catch (e) {
          resolve(xhr.responseText);
        }
      } else {
        if (targetUrl.includes("/v1/")) {
          const fallbackUrl = targetUrl.replace("/v1/", "/");
          console.log(`Local STT failed, trying fallback: ${fallbackUrl}...`);
          try {
            const fallbackHeaders: HeadersInit = {};
            if (apiKey && apiKey.trim()) {
              fallbackHeaders["Authorization"] = `Bearer ${apiKey.trim()}`;
            }
            const fallbackResponse = await fetch(fallbackUrl, {
              method: "POST",
              headers: fallbackHeaders,
              body: formData
            });
            if (fallbackResponse.ok) {
              const fData = await fallbackResponse.json();
              return resolve(fData.text || fData.transcript);
            }
          } catch (err) {}
        }
        reject(new Error(`Local STT server returned status ${xhr.status}. Response: ${xhr.responseText.substring(0, 200)}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error connecting to local STT server. Make sure your local STT engine (Faster-Whisper, vLLM STT, Groq, or Whisper.cpp) is running and accessible."));
    };

    xhr.send(formData);
  });
}

// Helper to upload a file in small 4MB chunks with an adaptive retry mechanism to bypass Cloud Run / GFE 32MB payload limit
async function uploadFileInChunks(
  file: File,
  isRawOnly: boolean,
  onProgress: (percent: number) => void,
  onStatusUpdate: (msg: string) => void,
  customTerms?: string[]
): Promise<string> {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks balance proxy compatibility, payload boundaries, and network speed
  const fileSize = file?.size ?? 0;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  const uploadId = `${Math.random().toString(36).substring(2, 11)}-${Date.now().toString(36)}`;
  
  onStatusUpdate(`Initializing file transmission in ${totalChunks} secure chunks...`);
  
  for (let i = 0; i < totalChunks; i++) {
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
      // Set absolute 5 minutes timeout for sending a file chunk (robust for all connection types)
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt) * 1000 + (Math.random() * 500); // add a little jitter
          onStatusUpdate(`Fragment ${i + 1} send failed. Retrying (attempt ${attempt + 1}/${maxRetries}) in ${(delay / 1000).toFixed(1)}s...`);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
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

        if (response.ok) {
          success = true;
          // Calculate progressive visual updates slice-by-slice
          const prevProgress = ((i + 1) / totalChunks) * 100;
          onProgress(Math.min(99, Math.round(prevProgress)));
        } else {
          let errorMsg = `Chunk ${i + 1} upload failed with status ${response.status}.`;
          try {
            const data = await response.json();
            errorMsg = data.error || errorMsg;
          } catch (_) {}
          throw new Error(errorMsg);
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
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
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    }
  }
  
  onStatusUpdate("Consolidating streams copy & launching Gemini transcriber...");
  onProgress(100);
  
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/transcribe-chunked");
    xhr.setRequestHeader("Content-Type", "application/json");
    
    xhr.onload = () => {
      let responseData;
      try {
        responseData = JSON.parse(xhr.responseText);
      } catch (err) {
        const rawPreview = xhr.responseText ? xhr.responseText.substring(0, 300) : "Empty response";
        responseData = { error: `An invalid server response was received (Status ${xhr.status}): ${rawPreview}` };
      }
      
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(responseData.text);
      } else {
        reject(new Error(responseData.error || "An error occurred during chunked transcription."));
      }
    };
    
    xhr.onerror = () => {
      reject(new Error("A network error occurred while running transcription."));
    };
    
    xhr.send(JSON.stringify({
      uploadId,
      fileName: file.name,
      totalChunks,
      rawOnly: isRawOnly,
      customTerms
    }));
  });
}

// Main transcription & reasoning runner supporting standard cloud and local models
export const transcribeAudio = (
  file: File,
  onProgress?: (percent: number) => void,
  provider: ModelProvider = ModelProvider.GEMINI,
  localConfig?: LocalConfig,
  onStatusUpdate?: (status: string) => void,
  customTerms?: string[]
): Promise<string> => {
  return new Promise(async (resolve, reject) => {
    let activeFile = file;

    const needsOptimization = provider === ModelProvider.GEMINI || 
      (provider === ModelProvider.LOCAL && localConfig?.transcriptionMode === TranscriptionMode.HYBRID);

    if (needsOptimization) {
      try {
        const { optimizeMediaFile } = await import("./audioProcessor");
        activeFile = await optimizeMediaFile(file, (msg) => {
          if (onStatusUpdate) onStatusUpdate(msg);
        });
      } catch (err) {
        console.warn("Client side audio process optimization failed; proceeding with raw file:", err);
      }
    }

    if (provider === ModelProvider.GEMINI) {
      const fileSize = activeFile?.size ?? file?.size ?? 0;
      // Chunked upload flow to bypass 32MB GFE Cloud Run limit for larger files (e.g. >10MB)
      if (fileSize > 10 * 1024 * 1024) {
        try {
          const result = await uploadFileInChunks(
            activeFile,
            false, // rawOnly = false
            onProgress || (() => {}),
            onStatusUpdate || (() => {}),
            customTerms
          );
          return resolve(result);
        } catch (err: any) {
          return reject(err);
        }
      }

      // Standard Gemini Cloud Flow for smaller files
      if (onStatusUpdate) onStatusUpdate("Uploading file to cloud server...");
      
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", activeFile);
      if (customTerms && customTerms.length > 0) {
        formData.append("customTerms", JSON.stringify(customTerms));
      }

      xhr.open("POST", "/api/transcribe");

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        let responseData;
        try {
          responseData = JSON.parse(xhr.responseText);
        } catch (err) {
          const rawPreview = xhr.responseText ? xhr.responseText.substring(0, 300) : "Empty response";
          responseData = { error: `An invalid server response was received (Status ${xhr.status}): ${rawPreview}` };
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(responseData.text);
        } else {
          reject(new Error(responseData.error || "An error occurred during transcription."));
        }
      };

      xhr.onerror = () => {
        reject(new Error("A network error occurred while uploading."));
      };

      xhr.send(formData);
    } else {
      // Local Model Provider Flow
      if (!localConfig) {
        return reject(new Error("Local model configuration is missing."));
      }

      try {
        let transcriptText = "";

        if (localConfig.transcriptionMode === TranscriptionMode.HYBRID) {
          // HYBRID MODE: Call Cloud Gemini server with rawOnly flag to fetch the raw core transcript
          if (onStatusUpdate) onStatusUpdate("Cloud: Gemini is performing rapid audio transcription...");
          
          const fileSize = activeFile?.size ?? file?.size ?? 0;
          if (fileSize > 10 * 1024 * 1024) {
            try {
              const result = await uploadFileInChunks(
                activeFile,
                true, // rawOnly = true
                onProgress || (() => {}),
                onStatusUpdate || (() => {}),
                customTerms
              );
              transcriptText = result;
            } catch (err: any) {
              return reject(err);
            }
          } else {
            const rawTranscript = await new Promise<string>((res, rej) => {
              const xhr = new XMLHttpRequest();
              const formData = new FormData();
              formData.append("file", activeFile);
              formData.append("rawOnly", "true");
              if (customTerms && customTerms.length > 0) {
                formData.append("customTerms", JSON.stringify(customTerms));
              }

              xhr.open("POST", "/api/transcribe");

              if (onProgress && xhr.upload) {
                xhr.upload.onprogress = (event) => {
                  if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    onProgress(percent);
                  }
                };
              }

              xhr.onload = () => {
                try {
                  const data = JSON.parse(xhr.responseText);
                  if (xhr.status >= 200 && xhr.status < 300) {
                    res(data.text);
                  } else {
                    rej(new Error(data.error || "Failed to fetch cloud transcription."));
                  }
                } catch (e) {
                  const rawPreview = xhr.responseText ? xhr.responseText.substring(0, 300) : "Empty response";
                  rej(new Error(`Invalid raw transcription response (Status ${xhr.status}): ${rawPreview}`));
                }
              };

              xhr.onerror = () => rej(new Error("Cloud raw upload failed due to network."));
              xhr.send(formData);
            });

            transcriptText = rawTranscript;
          }
        } else {
          // LOCAL STT MODE: Call local OpenAI-Compatible Whisper model
          if (onStatusUpdate) onStatusUpdate(`Local STT: Uploading and transcribing locally with ${localConfig.sttModel || "whisper"}...`);
          transcriptText = await callLocalSTT(
            localConfig.sttUrl, 
            localConfig.sttModel, 
            activeFile, 
            onProgress,
            localConfig.sttApiKey || localConfig.apiKey,
            localConfig.sttLanguage
          );
        }

        // Now prompt the Local LLM (e.g. gemma2 / gemma-4) to refine, format, and generate beautiful transcripts
        if (onStatusUpdate) {
          onStatusUpdate(`Local LLM: Feeding transcript to local model '${localConfig.llmModel}'...`);
        }
        
        let vocabularyHint = "";
        if (customTerms && customTerms.length > 0) {
          vocabularyHint = `\nSpecial vocabulary terms to correct spelling or phonetic voice-recognition errors:\n${customTerms.map(t => `- ${t}`).join("\n")}\n`;
        }

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

        const refinedResult = await callLocalLLM(
          localConfig.baseUrl, 
          localConfig.llmModel, 
          refinementPrompt,
          localConfig.apiKey,
          localConfig.engineType
        );
        resolve(refinedResult);

      } catch (err: any) {
        reject(new Error(err.message || "An error occurred during local model pipeline."));
      }
    }
  });
};
