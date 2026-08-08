# Media Scribe (WebM / Media Local & Cloud Transcriber)

A full-stack web application designed for transcribing and formatting audio and video files (`.webm`, `.mp4`, `.mov`, `.ogg`, `.wav`) into professional, speaker-segmented transcripts.

It supports **100% Fully Local Offline Execution** using local inference engines (vLLM, Ollama, LM Studio, Whisper) as well as **Google Gemini Cloud**.

---

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies & Start Application
```bash
# Install npm dependencies
npm install

# Start the dev server ( Express backend + Vite frontend on port 3000 )
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚡ Running 100% Fully Local (Offline Mode)

Media Scribe can run entirely on your local machine without sending any data to cloud services.

### Option A: vLLM Library (Recommended for High Performance)
Launch your local LLM (e.g., Gemma 4 or GPT-OSS) using vLLM:

```bash
# Launch Gemma 4 on port 8000
vllm serve google/gemma-4-9b-it --port 8000

# Or launch GPT-OSS on port 8000
vllm serve openai/gpt-oss-13b --port 8000
```

In Media Scribe UI settings:
1. Select **Local Models**.
2. Select **vLLM Library**.
3. Set Base URL to `http://localhost:8000/v1`.
4. Enter model name (`gemma4`, `google/gemma-4-9b-it`, or `gpt-oss`).

### Option B: Ollama
```bash
# Serve Gemma 4 locally
ollama run gemma4

# Or serve GPT-OSS locally
ollama run gpt-oss
```
Set Base URL to `http://localhost:11434` in Media Scribe settings.

### Option C: Local Speech-To-Text (Whisper & Modern STT Engines)
To transcribe audio offline with real-time speed or high multilingual accuracy, run an STT server:
```bash
# Faster-Whisper Server with whisper-large-v3-turbo (Real-time fast)
faster-whisper-server --port 1234 --model whisper-large-v3-turbo

# Or vLLM Audio STT on port 8000
vllm serve whisper-large-v3-turbo --port 8000
```
In Media Scribe UI settings under **Local Processing Strategy**:
- Choose **100% Offline (Local Whisper STT + Local LLM)**.
- Select your STT Provider: **Faster-Whisper**, **vLLM Audio**, **Groq Cloud STT**, **Ollama Audio**, or **Custom Endpoint**.
- Use **Auto-Discover STT Models** to detect loaded models.
- Choose from capable real-time & high-precision models (`whisper-large-v3-turbo`, `distil-whisper-large-v3`, `SenseVoiceSmall`, `Qwen/Qwen2-Audio-7B-Instruct`, `whisper-large-v3`).
- Specify audio spoken language (Auto-Detect or language codes like `en`, `es`, `fr`, `de`, `zh`, `ja`).

---

## 🌐 Hybrid Mode

If you want superfast cloud speech recognition paired with offline local structuring:
- Select **Hybrid Pipeline**.
- Large audio files are quickly transcribed in the cloud, then structured & summarized entirely by your local Gemma 4 / GPT-OSS model.

---

## ☁️ Optional Google Gemini Cloud Mode
To use Gemini Cloud directly:
1. Set `GEMINI_API_KEY` in your `.env` file or environment.
2. Select **Google Gemini Cloud** in the UI.

---

## 🛠️ Build for Production
```bash
# Build Vite static assets and bundle server.ts with esbuild
npm run build

# Start production build
npm run start
```
