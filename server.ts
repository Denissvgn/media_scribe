import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import multer from "multer";
import fs from "fs";
import { fetch as undiciFetch, Agent } from "undici";
import { GEMINI_MODEL, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MIB } from "./constants";
import { validateMediaFile, type MediaValidationResult } from "./mediaValidation";

// Configure a custom fetch handler for Node standard fetch.
// This resolves undici and Node internal fetch class-mismatch bugs (e.g. invalid content-length: NaN)
// during file/stream uploads by removing manual content-length headers when body is a Blob, while still
// providing high headersTimeout directly to long-running generateContent requests.
const relaxedAgent = new Agent({
  headersTimeout: 300000, // 5 minutes
  bodyTimeout: 300000,    // 5 minutes
  connectTimeout: 60000,  // 1 minute
  keepAliveTimeout: 60000 // 1 minute
});

const originalFetch = globalThis.fetch;

const customFetch = async (url: any, init: any) => {
  const urlStr = String(url);
  const options = { ...init };

  // Helper to safely parse and lowercase headers
  let headers: Record<string, string> = {};
  if (options.headers) {
    if (typeof options.headers.forEach === "function") {
      options.headers.forEach((value: string, key: string) => {
        headers[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [key, val] of options.headers) {
        headers[key.toLowerCase()] = val;
      }
    } else {
      for (const key of Object.keys(options.headers)) {
        headers[key.toLowerCase()] = (options.headers as any)[key];
      }
    }
  }

  // If the body is a Blob or FormData, delete the manual content-length header.
  // Native fetch/undici will automatically compute the correct content-length from the Blob body.
  const isBlobBody = options.body && (
    options.body instanceof globalThis.Blob ||
    options.body.constructor?.name === "Blob" ||
    typeof options.body.size === "number"
  );
  if (isBlobBody) {
    delete headers["content-length"];
  }

  options.headers = headers;

  // Apply relaxed undici agent solely to generateContent/models requests to prevent HeadersTimeoutError.
  if (urlStr.includes(":generateContent") || urlStr.includes("/models/")) {
    return undiciFetch(url, {
      ...options,
      dispatcher: relaxedAgent
    } as any);
  }

  return originalFetch(url, options);
};

globalThis.fetch = customFetch as any;

// Clean standard imports for full-stack service operations

const app = express();
const PORT = 3000;

type ApiErrorPayload = {
  error: string;
  code: string;
  stage: string;
  retryable: boolean;
  action?: string;
  suggestion?: string;
};

type MediaValidationFailure = Extract<MediaValidationResult, { valid: false }>;

function sendApiError(res: express.Response, status: number, payload: ApiErrorPayload) {
  return res.status(status).json(payload);
}

function sendMediaValidationError(
  res: express.Response,
  validation: MediaValidationFailure,
  stage: string
) {
  const status = validation.code === "FILE_TOO_LARGE" ? 413 : 400;
  const suggestion = validation.code === "FILE_TOO_LARGE"
    ? `Choose a media file no larger than ${MAX_FILE_SIZE_MIB} MiB.`
    : validation.code === "EMPTY_FILE"
      ? "Choose a non-empty media file and try again."
      : "Choose a supported WebM, Ogg/OGX, MP4, MOV, or WAV file.";

  return sendApiError(res, status, {
    error: validation.message,
    code: validation.code,
    stage,
    retryable: false,
    action: "choose_another_file",
    suggestion
  });
}

// Support JSON/Urlencoded payloads with generous body limits for large transcription configurations
app.use(express.json({ limit: "550mb" }));
app.use(express.urlencoded({ limit: "550mb", extended: true }));

const LOG_FILE = path.join(process.cwd(), "server.log");
try {
  fs.writeFileSync(LOG_FILE, `=== Server started at ${new Date().toISOString()} ===\n`);
} catch (e) {
  console.error("Failed to initialize server.log", e);
}

function serverLog(...args: any[]) {
  const msg = `[${new Date().toISOString()}] ${args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" ")}\n`;
  console.log(...args);
  try {
    fs.appendFileSync(LOG_FILE, msg);
  } catch (e) {
    console.error("Failed to write to server.log", e);
  }
}

// Global process exception traps
process.on("unhandledRejection", (reason, promise) => {
  serverLog("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (error) => {
  serverLog("UNCAUGHT EXCEPTION:", error);
});

// Comprehensive MIME-type helper mapping to guarantee correct container identification for Gemini API processing
function getMimeType(originalname: string, detectedMimeType?: string): string {
  const ext = originalname ? path.extname(originalname).toLowerCase() : "";
  const mime = detectedMimeType ? detectedMimeType.split(";")[0].trim().toLowerCase() : "";

  // 1. Map based on explicit file extensions first (highly reliable for fallbacks)
  if (ext === ".mp3") return "audio/mp3";
  if (ext === ".m4a") return "audio/m4a";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".ogg" || ext === ".ogx") return "audio/ogg";
  if (ext === ".opus") return "audio/opus";
  if (ext === ".webm") {
    // Map to audio/webm to guarantee we only extract audio track and save massive token usage
    return "audio/webm";
  }
  if (ext === ".mp4") return "audio/mp4";
  if (ext === ".mov" || ext === ".qt") return "audio/mp4"; // standard AAC inside MOV/QT can be treated as audio/mp4
  if (ext === ".avi") return "audio/mp3";
  if (ext === ".wmv") return "audio/mp3";
  if (ext === ".3gp" || ext === ".3gpp") return "audio/3gpp";
  if (ext === ".flv") return "audio/mp3";
  if (ext === ".mpeg" || ext === ".mpg") return "audio/mp3";

  // 2. Map based on detected MIME type if fallback is generic or missing
  if (mime && mime !== "application/octet-stream" && mime !== "binary/octet-stream" && mime !== "") {
    // Normalize some common weird mime types from browsers
    if (mime === "application/ogg") return "audio/ogg";
    if (mime === "audio/mpeg3" || mime === "audio/x-mpeg-3") return "audio/mp3";
    if (mime === "audio/x-m4a" || mime === "audio/x-mp4") return "audio/m4a";
    if (mime.startsWith("video/")) {
      if (mime === "video/mp4") return "audio/mp4";
      if (mime === "video/webm") return "audio/webm";
      return "audio/mp3"; // Fallback to MP3 audio for other video formats
    }
    return mime;
  }

  // 3. Absolute catch-all default
  return "audio/mp3";
}

const CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_FILE_SIZE_BYTES / CHUNK_SIZE_BYTES);
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    fetch: customFetch as any,
    httpOptions: {
      timeout: 360000,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  } as any);
}

function waitWithSignal(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException("The request was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function deleteGeminiFileBestEffort(ai: GoogleGenAI, name?: string) {
  if (!name) return;

  const cleanupController = new AbortController();
  const timeoutId = setTimeout(() => cleanupController.abort(), 10000);
  try {
    await ai.files.delete({
      name,
      config: { abortSignal: cleanupController.signal }
    });
  } catch (error) {
    serverLog(`Best-effort Gemini file cleanup failed for ${name}:`, error);
  } finally {
    clearTimeout(timeoutId);
  }
}

function removeTempFile(filePath?: string) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

function parseBoundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
      ? Number(value)
      : Number.NaN;

  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function isSafeUploadId(value: unknown): value is string {
  return typeof value === "string" && UPLOAD_ID_PATTERN.test(value);
}

function isSafeOriginalFileName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= 255
    && value !== "."
    && value !== ".."
    && !/[\\/\0-\x1F\x7F]/.test(value);
}

// Configure Multer to save disk files in /tmp/ while enforcing the public media contract.
const mediaUpload = multer({
  dest: "/tmp/",
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  }
});

// Chunks are exactly 4 MiB in the client protocol; a separate limit prevents one
// malformed segment from consuming the complete media-file allowance.
const chunkUpload = multer({
  dest: "/tmp/",
  limits: {
    fileSize: CHUNK_SIZE_BYTES,
  }
});

function handleSingleUpload(
  middleware: express.RequestHandler,
  stage: "upload" | "chunk_upload" | "local_stt"
): express.RequestHandler {
  return (req, res, next) => {
    middleware(req, res, (error: any) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        const isChunk = stage === "chunk_upload";
        sendApiError(res, 413, {
          error: isChunk
            ? "An upload segment exceeded the 4 MiB chunk limit."
            : `This file is larger than ${MAX_FILE_SIZE_MIB} MiB. Choose a smaller file and try again.`,
          code: isChunk ? "CHUNK_TOO_LARGE" : "FILE_TOO_LARGE",
          stage,
          retryable: false,
          action: isChunk ? "restart_upload" : "choose_another_file",
          suggestion: isChunk
            ? "Restart the upload. If the problem continues, choose the file again."
            : `Choose a media file no larger than ${MAX_FILE_SIZE_MIB} MiB.`
        });
        return;
      }

      serverLog(`Multipart ${stage} parsing failed:`, error);
      sendApiError(res, 400, {
        error: "The uploaded file data could not be read.",
        code: "UPLOAD_PARSE_FAILED",
        stage,
        retryable: true,
        action: "retry",
        suggestion: "Choose the file again. If the problem continues, check the browser or network connection."
      });
    });
  };
}

app.get("/api/preflight/gemini", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return sendApiError(res, 503, {
      error: "Gemini is not configured on this server.",
      code: "GEMINI_KEY_MISSING",
      stage: "preflight",
      retryable: false,
      action: "configure_server_key",
      suggestion: "Set GEMINI_API_KEY in the server environment, then restart Media Scribe."
    });
  }

  const controller = new AbortController();
  const abortCheck = () => controller.abort();
  const abortOnClosedResponse = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once("aborted", abortCheck);
  res.once("close", abortOnClosedResponse);

  try {
    const ai = createGeminiClient(apiKey);
    const model = await ai.models.get({
      model: GEMINI_MODEL,
      config: { abortSignal: controller.signal }
    });
    return res.json({
      ok: true,
      provider: "gemini",
      model: GEMINI_MODEL,
      resolvedModel: model.name || GEMINI_MODEL,
      message: "Gemini is configured and the transcription model is available."
    });
  } catch (error: any) {
    if (controller.signal.aborted && (req.aborted || res.destroyed)) return;
    const upstreamStatus = Number(error?.status ?? error?.code);
    const errorMessage = typeof error?.message === "string" ? error.message : "";
    const isAuthFailure = upstreamStatus === 401 || upstreamStatus === 403
      || /api key|permission|unauthenticated|forbidden/i.test(errorMessage);
    const isMissingModel = upstreamStatus === 404 || /model.*not found|not found.*model/i.test(errorMessage);
    const isRateLimited = upstreamStatus === 429 || /rate limit|resource exhausted/i.test(errorMessage);
    const isUnavailable = upstreamStatus === 503 || /unavailable|overloaded/i.test(errorMessage);

    serverLog("Gemini preflight failed:", error);

    if (isAuthFailure) {
      return sendApiError(res, 503, {
        error: "Gemini rejected the server API key.",
        code: "GEMINI_AUTH_FAILED",
        stage: "preflight",
        retryable: false,
        action: "configure_server_key",
        suggestion: "Set a valid GEMINI_API_KEY with access to the configured model, then restart the server."
      });
    }

    if (isMissingModel) {
      return sendApiError(res, 503, {
        error: `The configured Gemini model (${GEMINI_MODEL}) is not available to this server.`,
        code: "GEMINI_MODEL_UNAVAILABLE",
        stage: "preflight",
        retryable: false,
        action: "review_server_model",
        suggestion: "Verify the server model name and that the API project has access to it."
      });
    }

    if (isRateLimited) {
      return sendApiError(res, 429, {
        error: "Gemini is temporarily rate limited.",
        code: "GEMINI_RATE_LIMITED",
        stage: "preflight",
        retryable: true,
        action: "retry",
        suggestion: "Wait briefly, then test the Gemini route again."
      });
    }

    return sendApiError(res, isUnavailable ? 503 : 502, {
      error: isUnavailable
        ? "Gemini is temporarily unavailable."
        : "Media Scribe could not verify the Gemini model.",
      code: isUnavailable ? "GEMINI_UNAVAILABLE" : "GEMINI_PREFLIGHT_FAILED",
      stage: "preflight",
      retryable: true,
      action: "retry",
      suggestion: "Check the server network connection, then test the Gemini route again."
    });
  } finally {
    req.off("aborted", abortCheck);
    res.off("close", abortOnClosedResponse);
  }
});

// Secure API endpoint for transcription (supporting large files via Gemini File API)
app.post("/api/transcribe", handleSingleUpload(mediaUpload.single("file"), "upload"), async (req, res) => {
  const file = req.file;
  const controller = new AbortController();
  const abortOnRequest = () => controller.abort();
  const abortOnClosedResponse = () => {
    if (!res.writableEnded) controller.abort();
  };
  let ai: GoogleGenAI | null = null;
  let remoteFileName: string | undefined;
  req.once("aborted", abortOnRequest);
  res.once("close", abortOnClosedResponse);

  try {
    if (!file) {
      serverLog("Transcribe request received, but no file uploaded.");
      return sendApiError(res, 400, {
        error: "No file was uploaded.",
        code: "FILE_MISSING",
        stage: "validation",
        retryable: false,
        action: "choose_another_file",
        suggestion: "Choose a supported media file, then start transcription again."
      });
    }

    serverLog(`Transcribe request for file: ${file.originalname}, MIME: ${file.mimetype}, Size: ${file.size} bytes`);

    const validation = validateMediaFile({
      name: file.originalname,
      type: file.mimetype,
      size: file.size
    });
    if (validation.valid === false) {
      removeTempFile(file.path);
      return sendMediaValidationError(res, validation, "validation");
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      serverLog("ERROR: Gemini API key is missing on the server.");
      // Clean up uploaded file
      removeTempFile(file.path);
      return sendApiError(res, 503, {
        error: "Gemini is not configured on this server.",
        code: "GEMINI_KEY_MISSING",
        stage: "transcription",
        retryable: false,
        action: "configure_server_key",
        suggestion: "Set GEMINI_API_KEY in the server environment, then restart Media Scribe."
      });
    }

    // Initialize the GoogleGenAI client with the server-side API key
    ai = createGeminiClient(apiKey);

    // Resolve robust MIME type using name & detected type
    const mimeType = getMimeType(file.originalname, file.mimetype);

    serverLog(`Mapped MIME type for Gemini: ${mimeType}`);
    serverLog(`Uploading file ${file.originalname} (${(file.size / (1024 * 1024)).toFixed(2)} MB) to Gemini File API...`);
    
    // Upload the file directly using the Gemini File API via temporary path
    const fileUpload = await ai.files.upload({
      file: file.path,
      config: {
        mimeType: mimeType,
        abortSignal: controller.signal,
      }
    });
    remoteFileName = fileUpload.name;
    controller.signal.throwIfAborted();

    serverLog(`Uploaded to Gemini File API. Name: ${fileUpload.name}. Polling status...`);

    // Poll status until it is ACTIVE or FAILED
    let fileState = await ai.files.get({
      name: fileUpload.name,
      config: { abortSignal: controller.signal }
    });
    let attempts = 0;
    while (fileState.state === "PROCESSING" && attempts < 40) {
      await waitWithSignal(3000, controller.signal);
      fileState = await ai.files.get({
        name: fileUpload.name,
        config: { abortSignal: controller.signal }
      });
      attempts++;
    }
    controller.signal.throwIfAborted();

    serverLog(`Gemini File state is: ${fileState.state}`);

    if (fileState.state !== "ACTIVE") {
      serverLog(`File state was not ACTIVE. State: ${fileState.state}`);
      return sendApiError(res, 504, {
        error: `Gemini did not finish preparing the media (state: ${fileState.state}).`,
        code: "GEMINI_FILE_NOT_READY",
        stage: "transcription",
        retryable: true,
        action: "retry",
        suggestion: "Retry the transcription. If it repeats, verify the media file and Gemini service status."
      });
    }

    const rawOnly = req.body && req.body.rawOnly === "true";
    
    let customTerms: string[] = [];
    if (req.body.customTerms) {
      try {
        const parsed = JSON.parse(req.body.customTerms);
        if (Array.isArray(parsed)) {
          customTerms = parsed.filter((t: any) => typeof t === "string" && t.trim().length > 0);
        }
      } catch (e) {
        serverLog("Failed to parse customTerms from multpart form:", e);
      }
    }

    serverLog(`File is ACTIVE. Generating transcription & description with Gemini model ${GEMINI_MODEL} (rawOnly=${rawOnly}, customTermsCount=${customTerms.length})...`);

    let response;
    let retries = 3;
    let delay = 1000;

    let taskPrompt = rawOnly 
      ? "Please provide a highly accurate, verbatim transcription of this audio/video. Do not add any preamble, descriptions, or summaries. Answer with only the transcription text."
      : "Please provide a highly accurate, verbatim transcription of this audio/video, and also provide a brief description of its contents. If there are multiple speakers, label them as Speaker 1, Speaker 2, etc. Format the output with clear line breaks between speakers.";

    if (customTerms.length > 0) {
      taskPrompt += `\n\nTo maximize transcription accuracy and correct spelling/phonetic mistakes, please pay close attention to transcribing these specific terms or names if they are spoken in the audio/video:\n` + customTerms.map(t => `- ${t}`).join("\n");
    }

    while (true) {
      try {
        response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                {
                  fileData: {
                    fileUri: fileUpload.uri || "",
                    mimeType: fileUpload.mimeType || mimeType,
                  }
                },
                {
                  text: taskPrompt
                }
              ]
            }
          ],
          config: {
            abortSignal: controller.signal,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW
            }
          }
        });
        break; // Success, exit loop
      } catch (error: any) {
        controller.signal.throwIfAborted();
        retries--;
        const isUnavailable =
          error?.status === 503 ||
          error?.status === "UNAVAILABLE" ||
          (error instanceof Error &&
            (error.message.includes("503") ||
              error.message.includes("UNAVAILABLE")));

        serverLog(`Gemini generateContent call failed. Retries remaining: ${retries}. IsUnavailable: ${isUnavailable}. Error:`, error);

        if (isUnavailable && retries > 0) {
          serverLog(`Gemini API unavailable, retrying in ${delay}ms...`);
          await waitWithSignal(delay, controller.signal);
          delay *= 2; // Exponential backoff
        } else {
          throw error;
        }
      }
    }

    const text = response.text?.trim();
    if (!text) {
      serverLog("ERROR: No transcription was returned from the Gemini model (evaluated empty). Raw response text:", response.text);
      serverLog("Detailed response object:", JSON.stringify(response, null, 2));
      return sendApiError(res, 502, {
        error: "Gemini completed without returning transcript text.",
        code: "EMPTY_TRANSCRIPT",
        stage: "transcription",
        retryable: true,
        action: "retry",
        suggestion: "Retry the transcription. If it repeats, choose another supported media file."
      });
    }

    serverLog(`Transcription successfully generated! Length (chars): ${text.length}. Sample: ${text.substring(0, 120)}...`);
    return res.json({ text });

  } catch (error: any) {
    if (controller.signal.aborted && (req.aborted || res.destroyed)) {
      serverLog("Transcription request cancelled after the client disconnected.");
      return;
    }
    serverLog("Transcription endpoint error caught in try/catch:", error);

    const errorMessage = error?.message || "An unexpected error occurred during transcription.";
    
    // Customize user error messages matching previous frontend hints
    if (errorMessage.includes("400")) {
      return sendApiError(res, 400, {
        error: "Gemini rejected the media data.",
        code: "MEDIA_REJECTED",
        stage: "transcription",
        retryable: false,
        action: "choose_another_file",
        suggestion: "Choose a valid WebM, Ogg/OGX, MP4, MOV, or WAV file, then try again."
      });
    }
    if (errorMessage.includes("503") || errorMessage.includes("UNAVAILABLE")) {
      return sendApiError(res, 503, {
        error: "Gemini is currently overloaded.",
        code: "GEMINI_UNAVAILABLE",
        stage: "transcription",
        retryable: true,
        action: "retry",
        suggestion: "Wait briefly, then retry without choosing the file again."
      });
    }

    return sendApiError(res, 500, {
      error: "Gemini could not finish this transcription.",
      code: "GEMINI_TRANSCRIPTION_FAILED",
      stage: "transcription",
      retryable: true,
      action: "retry",
      suggestion: "Retry the transcription. If it repeats, check the server logs and Gemini configuration."
    });
  } finally {
    req.off("aborted", abortOnRequest);
    res.off("close", abortOnClosedResponse);
    removeTempFile(file?.path);
    if (ai && remoteFileName) {
      await deleteGeminiFileBestEffort(ai, remoteFileName);
    }
  }
});

// Helper to remove any uploaded chunk pieces on exception or cleanup
function cleanupChunks(uploadId: string, total: number) {
  if (!isSafeUploadId(uploadId)) return;
  const safeTotal = Number.isSafeInteger(total)
    ? Math.min(Math.max(total, 0), MAX_CHUNKS)
    : 0;

  for (let i = 0; i < safeTotal; i++) {
    const chunkPath = path.join("/tmp", `chunk-${uploadId}-${i}`);
    if (fs.existsSync(chunkPath)) {
      try { fs.unlinkSync(chunkPath); } catch (_) {}
    }
  }
}

// Idempotent cleanup for a browser-cancelled or failed chunk session. The upload
// identifier is random, scoped to one attempt, and validated before touching disk.
app.post("/api/cancel-chunked-upload", express.json({ limit: "8kb" }), (req, res) => {
  const uploadId = req.body?.uploadId;
  if (!isSafeUploadId(uploadId)) {
    return sendApiError(res, 400, {
      error: "The upload cleanup identifier is invalid.",
      code: "INVALID_CHUNK_METADATA",
      stage: "cleanup",
      retryable: false,
      action: "restart_upload",
      suggestion: "Restart the upload if any media remains selected."
    });
  }

  cleanupChunks(uploadId, MAX_CHUNKS);
  removeTempFile(path.join("/tmp", `final-${uploadId}`));
  return res.status(204).end();
});

// Proactively scavenge abandoned chunks as a last resort. Explicit client cleanup
// handles normal cancellation, while two hours leaves room for genuinely slow uploads.
function scavengeTempFiles() {
  try {
    const tmpDir = "/tmp";
    if (!fs.existsSync(tmpDir)) return;
    const files = fs.readdirSync(tmpDir);
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000;

    let count = 0;
    for (const f of files) {
      if (f.startsWith("chunk-") || f.startsWith("final-")) {
        const filePath = path.join(tmpDir, f);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            count++;
          }
        } catch (_) {}
      }
    }
    if (count > 0) {
      serverLog(`[Scavenger] Successfully purged ${count} orphaned transient slices from container memory-disk file-system.`);
    }
  } catch (e: any) {
    serverLog("[Scavenger ERROR] Fail-safe purge run encountered an issue:", e);
  }
}

// Secure chunk-based binary segment receiver to circumvent the GFE 32MB single post request limitation
app.post("/api/upload-chunk", handleSingleUpload(chunkUpload.single("file"), "chunk_upload"), async (req, res) => {
  const file = req.file;
  const uploadId = req.body?.uploadId;
  const fileName = req.body?.fileName;
  const totalChunks = parseBoundedInteger(req.body?.totalChunks, 1, MAX_CHUNKS);
  const chunkIndex = totalChunks === null
    ? null
    : parseBoundedInteger(req.body?.chunkIndex, 0, totalChunks - 1);
  
  if (!file) {
    serverLog("Chunk upload rejected: file raw stream was not present.");
    return sendApiError(res, 400, {
      error: "The upload segment did not contain file data.",
      code: "CHUNK_MISSING",
      stage: "chunk_upload",
      retryable: true,
      action: "retry",
      suggestion: "Retry the upload. If the problem continues, choose the file again."
    });
  }

  if (!isSafeUploadId(uploadId)
    || !isSafeOriginalFileName(fileName)
    || totalChunks === null
    || chunkIndex === null
  ) {
    serverLog("Chunk upload rejected: invalid session metadata.");
    removeTempFile(file.path);
    return sendApiError(res, 400, {
      error: "The upload segment metadata is invalid.",
      code: "INVALID_CHUNK_METADATA",
      stage: "chunk_upload",
      retryable: false,
      action: "restart_upload",
      suggestion: "Restart the upload. If the problem continues, choose the file again."
    });
  }

  if (file.size <= 0) {
    removeTempFile(file.path);
    return sendApiError(res, 400, {
      error: "The upload segment is empty.",
      code: "EMPTY_CHUNK",
      stage: "chunk_upload",
      retryable: true,
      action: "retry",
      suggestion: "Retry the upload. If the problem continues, choose the file again."
    });
  }

  try {
    const chunkPath = path.join("/tmp", `chunk-${uploadId}-${chunkIndex}`);
    // Overwrite existing parts in case of client retries
    if (fs.existsSync(chunkPath)) {
      try { fs.unlinkSync(chunkPath); } catch(_) {}
    }
    // Rename/move multer file to chunk path (near-instant on /tmp mount)
    fs.renameSync(file.path, chunkPath);
    
    serverLog(`Stored slice index ${chunkIndex}/${totalChunks} for session ${uploadId}`);
    return res.json({ success: true, chunkReceived: chunkIndex });
  } catch (error: any) {
    serverLog("Error saving chunk file:", error);
    removeTempFile(file.path);
    return sendApiError(res, 500, {
      error: "The server could not store this upload segment.",
      code: "CHUNK_STORAGE_FAILED",
      stage: "chunk_upload",
      retryable: true,
      action: "retry",
      suggestion: "Retry the upload. If the problem continues, check available server storage."
    });
  }
});

// Merger and transcriber core endpoint for reconstructed uploads
app.post("/api/transcribe-chunked", async (req, res) => {
  const uploadId = req.body?.uploadId;
  const fileName = req.body?.fileName;
  const totalChunks = parseBoundedInteger(req.body?.totalChunks, 1, MAX_CHUNKS);
  const rawOnly = req.body?.rawOnly;
  const customTerms = req.body?.customTerms;

  if (!isSafeUploadId(uploadId) || !isSafeOriginalFileName(fileName) || totalChunks === null) {
    serverLog("Transcribe-chunked rejected: invalid reconstruction metadata.");
    return sendApiError(res, 400, {
      error: "The upload reconstruction metadata is invalid.",
      code: "INVALID_CHUNK_METADATA",
      stage: "assembly",
      retryable: false,
      action: "restart_upload",
      suggestion: "Restart the upload. If the problem continues, choose the file again."
    });
  }
  
  let parsedCustomTerms: string[] = [];
  if (customTerms) {
    if (Array.isArray(customTerms)) {
      parsedCustomTerms = customTerms.filter((t: any) => typeof t === "string" && t.trim().length > 0);
    } else {
      try {
        const parsed = JSON.parse(customTerms);
        if (Array.isArray(parsed)) {
          parsedCustomTerms = parsed.filter((t: any) => typeof t === "string" && t.trim().length > 0);
        }
      } catch (e) {}
    }
  }

  serverLog(`Transcribe-chunked request: session ${uploadId}, file ${fileName}, total chunks: ${totalChunks}, customTermsCount: ${parsedCustomTerms.length}`);
  
  // The original name is metadata only. Keeping it out of the temporary path
  // eliminates traversal and platform-specific separator ambiguity.
  const finalPath = path.join("/tmp", `final-${uploadId}`);
  const controller = new AbortController();
  const abortOnRequest = () => controller.abort();
  const abortOnClosedResponse = () => {
    if (!res.writableEnded) controller.abort();
  };
  let ai: GoogleGenAI | null = null;
  let remoteFileName: string | undefined;
  req.once("aborted", abortOnRequest);
  res.once("close", abortOnClosedResponse);
  
  try {
    // 1. Sequentially append raw chunks without reading whole file into memory
    serverLog(`Consolidating ${totalChunks} fragments into unified target: ${finalPath}`);
    if (fs.existsSync(finalPath)) {
      try { fs.unlinkSync(finalPath); } catch(_) {}
    }
    
    let assembledSize = 0;
    for (let i = 0; i < totalChunks; i++) {
      // Yield between segments so a client disconnect can dispatch its abort
      // event even while a large reconstruction is underway.
      await new Promise<void>((resolve) => setImmediate(resolve));
      controller.signal.throwIfAborted();
      const chunkPath = path.join("/tmp", `chunk-${uploadId}-${i}`);
      if (!fs.existsSync(chunkPath)) {
        serverLog(`Consolidation error: Missing file chunk ${i} at: ${chunkPath}`);
        // Remove left-over segments
        cleanupChunks(uploadId, totalChunks);
        removeTempFile(finalPath);
        return sendApiError(res, 400, {
          error: `The upload is incomplete because segment ${i + 1} of ${totalChunks} is missing.`,
          code: "CHUNK_MISSING",
          stage: "assembly",
          retryable: false,
          action: "restart_upload",
          suggestion: "Restart the upload. The selected file and processing settings can remain unchanged."
        });
      }

      const chunkStats = fs.statSync(chunkPath);
      if (!chunkStats.isFile() || chunkStats.size <= 0 || chunkStats.size > CHUNK_SIZE_BYTES) {
        cleanupChunks(uploadId, totalChunks);
        removeTempFile(finalPath);
        return sendApiError(res, 400, {
          error: `Upload segment ${i + 1} is invalid.`,
          code: "INVALID_CHUNK",
          stage: "assembly",
          retryable: false,
          action: "restart_upload",
          suggestion: "Restart the upload. If the problem continues, choose the file again."
        });
      }

      assembledSize += chunkStats.size;
      if (assembledSize > MAX_FILE_SIZE_BYTES) {
        cleanupChunks(uploadId, totalChunks);
        removeTempFile(finalPath);
        return sendApiError(res, 413, {
          error: `This file is larger than ${MAX_FILE_SIZE_MIB} MiB. Choose a smaller file and try again.`,
          code: "FILE_TOO_LARGE",
          stage: "assembly",
          retryable: false,
          action: "choose_another_file",
          suggestion: `Choose a media file no larger than ${MAX_FILE_SIZE_MIB} MiB.`
        });
      }

      const data = fs.readFileSync(chunkPath);
      fs.appendFileSync(finalPath, data);
      
      // Clear chunk immediately to reclaim active storage
      try { fs.unlinkSync(chunkPath); } catch (_) {}
    }
    
    const mergedSize = fs.statSync(finalPath).size;
    serverLog(`Consolidation success! Output file size: ${(mergedSize / (1024 * 1024)).toFixed(2)} MB`);

    const validation = validateMediaFile({
      name: fileName,
      type: getMimeType(fileName),
      size: mergedSize
    });
    if (validation.valid === false) {
      removeTempFile(finalPath);
      return sendMediaValidationError(res, validation, "assembly");
    }
    
    // 2. Perform Gemini Cloud Upload and Processing
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      serverLog("ERROR: Gemini API key is missing on the server.");
      removeTempFile(finalPath);
      return sendApiError(res, 503, {
        error: "Gemini is not configured on this server.",
        code: "GEMINI_KEY_MISSING",
        stage: "transcription",
        retryable: false,
        action: "configure_server_key",
        suggestion: "Set GEMINI_API_KEY in the server environment, then restart Media Scribe."
      });
    }

    ai = createGeminiClient(apiKey);

    // Resolve robust MIME type using name
    const mimeType = getMimeType(fileName);

    serverLog(`Mapped reconstructed MIME type: ${mimeType}`);
    serverLog("Uploading final assembled file to Gemini Cloud API on behalf of client...");
    
    const fileUpload = await ai.files.upload({
      file: finalPath,
      config: {
        mimeType: mimeType,
        abortSignal: controller.signal,
      }
    });
    remoteFileName = fileUpload.name;
    controller.signal.throwIfAborted();

    serverLog(`Uploaded, assigned ID: ${fileUpload.name}. Initializing Cloud state polling...`);

    let fileState = await ai.files.get({
      name: fileUpload.name,
      config: { abortSignal: controller.signal }
    });
    let attempts = 0;
    while (fileState.state === "PROCESSING" && attempts < 40) {
      await waitWithSignal(3000, controller.signal);
      fileState = await ai.files.get({
        name: fileUpload.name,
        config: { abortSignal: controller.signal }
      });
      attempts++;
    }
    controller.signal.throwIfAborted();

    serverLog(`Gemini Cloud File final state: ${fileState.state}`);

    if (fileState.state !== "ACTIVE") {
      return sendApiError(res, 504, {
        error: `Gemini did not finish preparing the assembled media (state: ${fileState.state}).`,
        code: "GEMINI_FILE_NOT_READY",
        stage: "transcription",
        retryable: true,
        action: "retry",
        suggestion: "Retry the transcription. If it repeats, verify the media file and Gemini service status."
      });
    }

    const isRawOnly = rawOnly === "true" || rawOnly === true;
    serverLog(`Triggering generateContent (rawOnly=${isRawOnly})...`);

    let taskPrompt = isRawOnly 
      ? "Please provide a highly accurate, verbatim transcription of this audio/video. Do not add any preamble, descriptions, or summaries. Answer with only the transcription text."
      : "Please provide a highly accurate, verbatim transcription of this audio/video, and also provide a brief description of its contents. If there are multiple speakers, label them as Speaker 1, Speaker 2, etc. Format the output with clear line breaks between speakers.";

    if (parsedCustomTerms.length > 0) {
      taskPrompt += `\n\nTo maximize transcription accuracy and correct spelling/phonetic mistakes, please pay close attention to transcribing these specific terms or names if they are spoken in the audio/video:\n` + parsedCustomTerms.map(t => `- ${t}`).join("\n");
    }

    let response;
    let retries = 3;
    let delay = 1000;

    while (true) {
      try {
        response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                {
                  fileData: {
                    fileUri: fileUpload.uri || "",
                    mimeType: fileUpload.mimeType || mimeType,
                  }
                },
                {
                  text: taskPrompt
                }
              ]
            }
          ],
          config: {
            abortSignal: controller.signal,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW
            }
          }
        });
        break;
      } catch (error: any) {
        controller.signal.throwIfAborted();
        retries--;
        const isUnavailable =
          error?.status === 503 ||
          error?.status === "UNAVAILABLE" ||
          (error instanceof Error &&
            (error.message.includes("503") ||
              error.message.includes("UNAVAILABLE")));

        serverLog(`Gemini generateContent call failed. Retries remaining: ${retries}. IsUnavailable: ${isUnavailable}. Error:`, error);

        if (isUnavailable && retries > 0) {
          serverLog(`Gemini API unavailable, retrying in ${delay}ms...`);
          await waitWithSignal(delay, controller.signal);
          delay *= 2; 
        } else {
          throw error;
        }
      }
    }

    const text = response.text?.trim();
    if (!text) {
      serverLog("ERROR: Empty transcript content returned by Gemini. Raw response text:", response.text);
      serverLog("Detailed response object (Chunked):", JSON.stringify(response, null, 2));
      return sendApiError(res, 502, {
        error: "Gemini completed without returning transcript text.",
        code: "EMPTY_TRANSCRIPT",
        stage: "transcription",
        retryable: true,
        action: "retry",
        suggestion: "Retry the transcription. If it repeats, choose another supported media file."
      });
    }

    serverLog(`Transcription successfully rendered (Assembled Flow)! Length (chars): ${text.length}. Sample: ${text.substring(0, 120)}...`);
    return res.json({ text });

  } catch (error: any) {
    if (controller.signal.aborted && (req.aborted || res.destroyed)) {
      serverLog("Chunked transcription request cancelled after the client disconnected.");
      return;
    }
    serverLog("Transcription chunked assembly critical error:", error);
    return sendApiError(res, 500, {
      error: error?.message || "An exception occurred during stream assembly.",
      code: "ASSEMBLY_FAILED",
      stage: "assembly",
      retryable: true,
      action: "retry",
      suggestion: "Retry the transcription. If the problem continues, check available server storage and logs."
    });
  } finally {
    req.off("aborted", abortOnRequest);
    res.off("close", abortOnClosedResponse);
    removeTempFile(finalPath);
    cleanupChunks(uploadId, totalChunks);
    if (ai && remoteFileName) {
      await deleteGeminiFileBestEffort(ai, remoteFileName);
    }
  }
});

function resolveSttTranscriptionUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;

  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/audio/transcriptions")) {
      url.pathname = pathname;
    } else if (pathname.endsWith("/v1")) {
      url.pathname = `${pathname}/audio/transcriptions`;
    } else {
      url.pathname = `${pathname}/v1/audio/transcriptions`;
    }
    url.search = "";
    url.hash = "";
    return url;
  } catch (_) {
    return null;
  }
}

function isSafeShortField(value: unknown, maximumLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximumLength
    && !/[\0-\x1F\x7F]/.test(value);
}

// Same-origin relay for the runtime STT upload. This complements model discovery
// when a local endpoint is healthy but does not allow browser CORS requests.
app.post(
  "/api/local-stt-proxy",
  handleSingleUpload(mediaUpload.single("file"), "local_stt"),
  async (req, res) => {
    const file = req.file;
    const targetUrl = resolveSttTranscriptionUrl(req.body?.targetUrl);
    const model = req.body?.model;
    const language = req.body?.language;
    const apiKey = req.body?.apiKey;

    if (!file) {
      return sendApiError(res, 400, {
        error: "No file was uploaded.",
        code: "FILE_MISSING",
        stage: "local_stt",
        retryable: false,
        action: "choose_another_file",
        suggestion: "Choose a supported media file, then retry transcription."
      });
    }

    const validation = validateMediaFile({
      name: file.originalname,
      type: file.mimetype,
      size: file.size
    });
    if (validation.valid === false) {
      removeTempFile(file.path);
      return sendMediaValidationError(res, validation, "local_stt");
    }

    if (!targetUrl || !isSafeShortField(model, 256)) {
      removeTempFile(file.path);
      return sendApiError(res, 400, {
        error: "The local speech endpoint or model identifier is invalid.",
        code: "INVALID_STT_CONFIGURATION",
        stage: "local_stt",
        retryable: false,
        action: "review_settings",
        suggestion: "Enter an http(s) STT endpoint and a model identifier, then test the route again."
      });
    }

    if (language !== undefined && language !== "" && !isSafeShortField(language, 64)) {
      removeTempFile(file.path);
      return sendApiError(res, 400, {
        error: "The speech language value is invalid.",
        code: "INVALID_STT_LANGUAGE",
        stage: "local_stt",
        retryable: false,
        action: "review_settings",
        suggestion: "Choose Automatic or enter a valid language code."
      });
    }

    if (apiKey !== undefined && apiKey !== ""
      && (typeof apiKey !== "string" || apiKey.length > 4096 || /[\r\n\0]/.test(apiKey))
    ) {
      removeTempFile(file.path);
      return sendApiError(res, 400, {
        error: "The STT API key value is invalid.",
        code: "INVALID_STT_API_KEY",
        stage: "local_stt",
        retryable: false,
        action: "review_settings",
        suggestion: "Re-enter the STT API key, then test the route again."
      });
    }

    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    const abortOnClosedResponse = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once("aborted", abortUpstream);
    res.once("close", abortOnClosedResponse);

    try {
      const formData = new FormData();
      const mediaBlob = await fs.openAsBlob(file.path, {
        type: file.mimetype || getMimeType(file.originalname)
      });
      formData.append("file", mediaBlob, file.originalname);
      formData.append("model", model.trim());
      if (typeof language === "string" && language.trim() && language !== "auto") {
        formData.append("language", language.trim());
      }

      const headers: Record<string, string> = {};
      if (typeof apiKey === "string" && apiKey.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      }

      const upstream = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal
      });
      const responseText = await upstream.text();
      const contentType = upstream.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        try {
          return res.status(upstream.status).json(JSON.parse(responseText));
        } catch (_) {
          // Fall through to the structured invalid-response error below.
        }
      }

      if (upstream.ok && responseText.trim()) {
        return res.status(upstream.status).json({ text: responseText });
      }

      return sendApiError(res, upstream.status || 502, {
        error: "The local speech endpoint returned an unreadable response.",
        code: "LOCAL_STT_INVALID_RESPONSE",
        stage: "local_stt",
        retryable: upstream.status >= 500,
        action: upstream.status >= 500 ? "retry" : "review_settings",
        suggestion: "Verify that the endpoint supports OpenAI-compatible audio transcription responses."
      });
    } catch (error: any) {
      if (controller.signal.aborted && (req.aborted || res.destroyed)) {
        return;
      }

      serverLog(`Local STT proxy failed to connect to ${targetUrl.origin}:`, error);
      return sendApiError(res, 502, {
        error: "Media Scribe could not reach the local speech endpoint.",
        code: "LOCAL_STT_UNREACHABLE",
        stage: "local_stt",
        retryable: true,
        action: "review_settings",
        suggestion: "Confirm the STT server is running, then verify its URL, port, and API key."
      });
    } finally {
      req.off("aborted", abortUpstream);
      res.off("close", abortOnClosedResponse);
      removeTempFile(file.path);
    }
  }
);

// Proxy endpoint to relay local model/STT server requests if browser experiences CORS restrictions
app.post("/api/local-proxy", express.json({ limit: "50mb" }), async (req, res) => {
  const { targetUrl, method = "POST", headers = {}, body } = req.body;

  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch (_) {
    return sendApiError(res, 400, {
      error: "The configured endpoint URL is invalid.",
      code: "INVALID_PROXY_TARGET",
      stage: "preflight",
      retryable: false,
      action: "review_settings",
      suggestion: "Enter a complete http(s) endpoint in Expert settings."
    });
  }

  if (typeof targetUrl !== "string"
    || targetUrl.length > 2048
    || (target.protocol !== "http:" && target.protocol !== "https:")
    || target.username
    || target.password
  ) {
    return sendApiError(res, 400, {
      error: "The configured endpoint URL is not supported.",
      code: "INVALID_PROXY_TARGET",
      stage: "preflight",
      retryable: false,
      action: "review_settings",
      suggestion: "Use an http(s) endpoint without embedded credentials."
    });
  }

  const proxyPath = target.pathname.replace(/\/+$/, "");
  const allowedProxyPaths = ["/models", "/chat/completions", "/api/tags", "/api/generate"];
  const blockedProxyHosts = new Set([
    "169.254.169.254",
    "169.254.170.2",
    "100.100.100.200",
    "metadata.google.internal"
  ]);
  if (!allowedProxyPaths.some(suffix => proxyPath.endsWith(suffix))
    || blockedProxyHosts.has(target.hostname.toLowerCase())
    || target.hostname.toLowerCase().startsWith("fe80:")
  ) {
    return sendApiError(res, 400, {
      error: "The relay target is outside the supported model API surface.",
      code: "PROXY_TARGET_NOT_ALLOWED",
      stage: "preflight",
      retryable: false,
      action: "review_settings",
      suggestion: "Use an OpenAI-compatible models/chat endpoint or an Ollama tags/generate endpoint."
    });
  }
  target.search = "";
  target.hash = "";

  const normalizedMethod = String(method).toUpperCase();
  if (normalizedMethod !== "GET" && normalizedMethod !== "POST") {
    return sendApiError(res, 405, {
      error: "The endpoint test only supports GET and POST requests.",
      code: "PROXY_METHOD_NOT_ALLOWED",
      stage: "preflight",
      retryable: false,
      action: "review_settings",
      suggestion: "Check the selected engine type and endpoint URL."
    });
  }

  const controller = new AbortController();
  const abortUpstream = () => controller.abort();
  const abortOnClosedResponse = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once("aborted", abortUpstream);
  res.once("close", abortOnClosedResponse);

  try {
    serverLog(`Relaying local proxy request to ${target.origin}${target.pathname}...`);
    const safeHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (headers && typeof headers === "object") {
      for (const [name, value] of Object.entries(headers)) {
        const normalizedName = name.toLowerCase();
        if ((normalizedName === "authorization" || normalizedName === "content-type") && typeof value === "string") {
          safeHeaders[normalizedName === "authorization" ? "Authorization" : "Content-Type"] = value;
        }
      }
    }
    const options: RequestInit = {
      method: normalizedMethod,
      headers: safeHeaders,
      signal: controller.signal
    };

    if (body) {
      options.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(target, options);
    const contentType = response.headers.get("content-type") || "";
    
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      return res.status(response.status).send(text);
    }
  } catch (err: any) {
    if (controller.signal.aborted && (req.aborted || res.destroyed)) return;
    serverLog(`Local proxy failed to connect to ${target.origin}:`, err);
    return sendApiError(res, 502, {
      error: "Media Scribe could not reach the configured processing endpoint.",
      code: "LOCAL_ENDPOINT_UNREACHABLE",
      stage: "preflight",
      retryable: true,
      action: "review_settings",
      suggestion: "Confirm the service is running, then verify its URL, port, credentials, and engine type."
    });
  } finally {
    req.off("aborted", abortUpstream);
    res.off("close", abortOnClosedResponse);
  }
});

async function startServer() {
  // Start the background scavenger to prune stale chunks from the container's disk periodically
  setInterval(scavengeTempFiles, 5 * 60 * 1000);
  // Run an initial scavenge to clear any leftover debris from previous server instances
  setTimeout(scavengeTempFiles, 5000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
