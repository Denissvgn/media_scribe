import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import multer from "multer";
import fs from "fs";
import { fetch as undiciFetch, Agent } from "undici";

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

// Configure Multer to save disk files in /tmp/ directory for seamless streaming
const upload = multer({
  dest: "/tmp/",
  limits: {
    fileSize: 550 * 1024 * 1024, // Support up to 550MB file size
  }
});

const GEMINI_MODEL = "gemini-flash-latest";

// Secure API endpoint for transcription (supporting large files via Gemini File API)
app.post("/api/transcribe", upload.single("file"), async (req, res) => {
  const file = req.file;
  try {
    if (!file) {
      serverLog("Transcribe request received, but no file uploaded.");
      return res.status(400).json({ error: "No file was uploaded." });
    }

    serverLog(`Transcribe request for file: ${file.originalname}, MIME: ${file.mimetype}, Size: ${file.size} bytes`);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      serverLog("ERROR: Gemini API key is missing on the server.");
      // Clean up uploaded file
      try { fs.unlinkSync(file.path); } catch (e) {}
      return res.status(500).json({ 
        error: "Gemini API key is not configured on the server. Please check your environment variables." 
      });
    }

    // Initialize the GoogleGenAI client with the server-side API key
    const ai = new GoogleGenAI({
      apiKey,
      fetch: customFetch as any,
      httpOptions: {
        timeout: 360000, // 6 minutes timeout for API calls
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    } as any);

    // Resolve robust MIME type using name & detected type
    const mimeType = getMimeType(file.originalname, file.mimetype);

    serverLog(`Mapped MIME type for Gemini: ${mimeType}`);
    serverLog(`Uploading file ${file.originalname} (${(file.size / (1024 * 1024)).toFixed(2)} MB) to Gemini File API...`);
    
    // Upload the file directly using the Gemini File API via temporary path
    const fileUpload = await ai.files.upload({
      file: file.path,
      config: {
        mimeType: mimeType,
      }
    });

    serverLog(`Uploaded to Gemini File API. Name: ${fileUpload.name}. Polling status...`);

    // Poll status until it is ACTIVE or FAILED
    let fileState = await ai.files.get({ name: fileUpload.name });
    let attempts = 0;
    while (fileState.state === "PROCESSING" && attempts < 40) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      fileState = await ai.files.get({ name: fileUpload.name });
      attempts++;
    }

    serverLog(`Gemini File state is: ${fileState.state}`);

    if (fileState.state !== "ACTIVE") {
      // Clean up local temp file
      try { fs.unlinkSync(file.path); } catch (e) {}
      // Clean up Gemini File API file
      try { await ai.files.delete({ name: fileUpload.name }); } catch (e) {}
      serverLog(`File state was not ACTIVE. State: ${fileState.state}`);
      return res.status(500).json({ 
        error: `Gemini file processing failed or timed out with state: ${fileState.state}` 
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
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW
            }
          }
        });
        break; // Success, exit loop
      } catch (error: any) {
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
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        } else {
          throw error;
        }
      }
    }

    // Clean up temporary local file
    try {
      fs.unlinkSync(file.path);
    } catch (err) {
      serverLog("Failed to delete local temp file:", err);
    }

    // Clean up file from Gemini File API to free space quota (10GB max per project)
    try {
      await ai.files.delete({ name: fileUpload.name });
    } catch (err) {
      serverLog("Failed to delete file from Gemini File API:", err);
    }

    const text = response.text?.trim();
    if (!text) {
      serverLog("ERROR: No transcription was returned from the Gemini model (evaluated empty). Raw response text:", response.text);
      serverLog("Detailed response object:", JSON.stringify(response, null, 2));
      return res.status(500).json({ error: "The transcription generation returned blank or empty text." });
    }

    serverLog(`Transcription successfully generated! Length (chars): ${text.length}. Sample: ${text.substring(0, 120)}...`);
    return res.json({ text });

  } catch (error: any) {
    serverLog("Transcription endpoint error caught in try/catch:", error);
    
    // Clean up uploaded file if it still exists
    if (file && file.path) {
      try { fs.unlinkSync(file.path); } catch (e) {}
    }

    const errorMessage = error?.message || "An unexpected error occurred during transcription.";
    
    // Customize user error messages matching previous frontend hints
    if (errorMessage.includes("400")) {
      return res.status(400).json({ 
        error: "The file data was rejected by the server. Please ensure it is a valid .webm, .ogx, .mp4, or .mov file." 
      });
    }
    if (errorMessage.includes("503") || errorMessage.includes("UNAVAILABLE")) {
      return res.status(503).json({ 
        error: "The Gemini API service is currently overloaded. Please try again in a few moments." 
      });
    }

    return res.status(500).json({ error: errorMessage });
  }
});

// Helper to remove any uploaded chunk pieces on exception or cleanup
function cleanupChunks(uploadId: string, total: number) {
  for (let i = 0; i < total; i++) {
    const chunkPath = path.join("/tmp", `chunk-${uploadId}-${i}`);
    if (fs.existsSync(chunkPath)) {
      try { fs.unlinkSync(chunkPath); } catch (_) {}
    }
  }
}

// Proactively scavenge any abandoned chunk or assembled file pieces (>20 mins old) to protect the container's disk capacity
function scavengeTempFiles() {
  try {
    const tmpDir = "/tmp";
    if (!fs.existsSync(tmpDir)) return;
    const files = fs.readdirSync(tmpDir);
    const now = Date.now();
    const maxAge = 20 * 60 * 1000; // 20 minutes maximum transient lifetime

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
app.post("/api/upload-chunk", upload.single("file"), async (req, res) => {
  const file = req.file;
  const { uploadId, chunkIndex, totalChunks, fileName } = req.body;
  
  if (!file) {
    serverLog("Chunk upload rejected: file raw stream was not present.");
    return res.status(400).json({ error: "Missing chunk binary content." });
  }
  
  if (!uploadId || chunkIndex === undefined) {
    serverLog("Chunk upload rejected: upload session ID or chunk index missing.");
    try { fs.unlinkSync(file.path); } catch(_) {}
    return res.status(400).json({ error: "Missing session or segment pointers." });
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
    return res.json({ success: true, chunkReceived: Number(chunkIndex) });
  } catch (error: any) {
    serverLog("Error saving chunk file:", error);
    try { fs.unlinkSync(file.path); } catch(_) {}
    return res.status(500).json({ error: error?.message || "Internal chunk preservation failure." });
  }
});

// Merger and transcriber core endpoint for reconstructed uploads
app.post("/api/transcribe-chunked", async (req, res) => {
  const { uploadId, fileName, totalChunks, rawOnly, customTerms } = req.body;
  
  if (!uploadId || !fileName || !totalChunks) {
    serverLog("Transcribe-chunked rejected: Missing metadata.");
    return res.status(400).json({ error: "Missing reconstruction instructions." });
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
  
  const finalPath = path.join("/tmp", `final-${uploadId}-${fileName}`);
  
  try {
    // 1. Sequentially append raw chunks without reading whole file into memory
    serverLog(`Consolidating ${totalChunks} fragments into unified target: ${finalPath}`);
    if (fs.existsSync(finalPath)) {
      try { fs.unlinkSync(finalPath); } catch(_) {}
    }
    
    for (let i = 0; i < Number(totalChunks); i++) {
      const chunkPath = path.join("/tmp", `chunk-${uploadId}-${i}`);
      if (!fs.existsSync(chunkPath)) {
        serverLog(`Consolidation error: Missing file chunk ${i} at: ${chunkPath}`);
        // Remove left-over segments
        cleanupChunks(uploadId, Number(totalChunks));
        return res.status(400).json({ error: `Transmission stream interrupted: block ${i} is missing.` });
      }
      const data = fs.readFileSync(chunkPath);
      fs.appendFileSync(finalPath, data);
      
      // Clear chunk immediately to reclaim active storage
      try { fs.unlinkSync(chunkPath); } catch (_) {}
    }
    
    const mergedSize = fs.statSync(finalPath).size;
    serverLog(`Consolidation success! Output file size: ${(mergedSize / (1024 * 1024)).toFixed(2)} MB`);
    
    // 2. Perform Gemini Cloud Upload and Processing
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      serverLog("ERROR: Gemini API key is missing on the server.");
      try { fs.unlinkSync(finalPath); } catch (e) {}
      return res.status(500).json({ 
        error: "Gemini API key is not configured on the server. Please check your environment variables." 
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      fetch: customFetch as any,
      httpOptions: {
        timeout: 360000, // 6 minutes timeout for API calls
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    } as any);

    // Resolve robust MIME type using name
    const mimeType = getMimeType(fileName);

    serverLog(`Mapped reconstructed MIME type: ${mimeType}`);
    serverLog("Uploading final assembled file to Gemini Cloud API on behalf of client...");
    
    const fileUpload = await ai.files.upload({
      file: finalPath,
      config: {
        mimeType: mimeType,
      }
    });

    serverLog(`Uploaded, assigned ID: ${fileUpload.name}. Initializing Cloud state polling...`);

    let fileState = await ai.files.get({ name: fileUpload.name });
    let attempts = 0;
    while (fileState.state === "PROCESSING" && attempts < 40) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      fileState = await ai.files.get({ name: fileUpload.name });
      attempts++;
    }

    serverLog(`Gemini Cloud File final state: ${fileState.state}`);

    if (fileState.state !== "ACTIVE") {
      try { fs.unlinkSync(finalPath); } catch (e) {}
      try { await ai.files.delete({ name: fileUpload.name }); } catch (e) {}
      return res.status(500).json({ 
        error: `Gemini file content processing halted by Cloud API with state: ${fileState.state}` 
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
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW
            }
          }
        });
        break;
      } catch (error: any) {
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
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; 
        } else {
          throw error;
        }
      }
    }

    // Clean up temporary local finalized file
    try { fs.unlinkSync(finalPath); } catch (_) {}

    // Clean up remote asset to free project storage quotas
    try {
      await ai.files.delete({ name: fileUpload.name });
    } catch (err) {
      serverLog("Failed to delete file from Gemini File API:", err);
    }

    const text = response.text?.trim();
    if (!text) {
      serverLog("ERROR: Empty transcript content returned by Gemini. Raw response text:", response.text);
      serverLog("Detailed response object (Chunked):", JSON.stringify(response, null, 2));
      return res.status(500).json({ error: "The transcription generation returned blank or empty text." });
    }

    serverLog(`Transcription successfully rendered (Assembled Flow)! Length (chars): ${text.length}. Sample: ${text.substring(0, 120)}...`);
    return res.json({ text });

  } catch (error: any) {
    serverLog("Transcription chunked assembly critical error:", error);
    try { fs.unlinkSync(finalPath); } catch (_) {}
    cleanupChunks(uploadId, Number(totalChunks));
    return res.status(500).json({ error: error?.message || "An exception occurred during stream assembly." });
  }
});

// Proxy endpoint to relay local model/STT server requests if browser experiences CORS restrictions
app.post("/api/local-proxy", express.json({ limit: "50mb" }), async (req, res) => {
  const { targetUrl, method = "POST", headers = {}, body } = req.body;

  if (!targetUrl || typeof targetUrl !== "string") {
    return res.status(400).json({ error: "Missing valid targetUrl string." });
  }

  try {
    serverLog(`Relaying local proxy request to ${targetUrl}...`);
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers
      }
    };

    if (body) {
      options.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(targetUrl, options);
    const contentType = response.headers.get("content-type") || "";
    
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      return res.status(response.status).send(text);
    }
  } catch (err: any) {
    serverLog(`Local proxy failed to connect to ${targetUrl}:`, err);
    return res.status(502).json({
      error: `Proxy connection failure to local host at ${targetUrl}. ${err.message || ""}. Ensure your local server (vLLM, Ollama, LM Studio) is running and accessible.`
    });
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
