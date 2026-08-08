/**
 * Utilities for client-side audio extraction, decoding, downsampling, and mono conversion.
 * By downsampling audio/video tracks to mono 12kHz WAV files, we reduce payload sizes by up to 100x
 * and guarantee they fit comfortably under the 32MB standard Cloud Run upload limit.
 */

/**
 * Downsamples an incoming media file (audio or video) to a target sample rate (e.g., 12kHz or 16kHz)
 * at 1 channel (mono) using the hardware-accelerated Web Audio API.
 */
export async function downsampleAudio(
  arrayBuffer: ArrayBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio API is not supported in this browser.");
  }

  const tempCtx = new AudioContextClass();
  
  // Decode the incoming audio or video data
  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      try {
        const promise = tempCtx.decodeAudioData(
          arrayBuffer,
          (buffer) => resolve(buffer),
          (err) => reject(err)
        );
        // If the browser returned a promise from decodeAudioData, explicitly catch its rejection
        if (promise && typeof promise.catch === "function") {
          promise.catch((pErr) => {
            reject(pErr);
          });
        }
      } catch (err) {
        reject(err);
      }
    });
  } finally {
    // Ensure the temporary context is closed to free hardware audio nodes
    try {
      await tempCtx.close();
    } catch (e) {
      console.error("Failed to close temp AudioContext:", e);
    }
  }

  // Use OfflineAudioContext for extremely fast offline rendering
  const OfflineContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OfflineContextClass) {
    throw new Error("OfflineAudioContext is not supported in this browser.");
  }

  const totalSamples = Math.round(decodedBuffer.duration * targetSampleRate);
  const offlineCtx = new OfflineContextClass(
    1, // 1 channel (Mono)
    totalSamples,
    targetSampleRate
  );

  // Setup the audio graph: buffer source -> offline context destination
  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = decodedBuffer;
  sourceNode.connect(offlineCtx.destination);
  sourceNode.start(0);

  // Perform parallel audio rendering
  return await offlineCtx.startRendering();
}

/**
 * Encodes an AudioBuffer into an Omitted/Raw RIFF-WAV file (16-bit PCM Linear Mono).
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = 1; // Mono destination guaranteed by OfflineAudioContext
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const format = 1; // 1 = Raw PCM
  
  const channelData = buffer.getChannelData(0);
  const bufferLength = channelData.length * 2; // 2 bytes per 16-bit sample
  const wavBuffer = new ArrayBuffer(44 + bufferLength);
  const view = new DataView(wavBuffer);
  
  /* Write standard RIFF WAVE Header */
  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // File length
  view.setUint32(4, 36 + bufferLength, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // Format chunk identifier
  writeString(view, 12, 'fmt ');
  // Format chunk length
  view.setUint32(16, 16, true);
  // Sample format (uncompressed linear PCM)
  view.setUint16(20, format, true);
  // Channel count
  view.setUint16(22, numOfChan, true);
  // Sample rate
  view.setUint32(24, sampleRate, true);
  // Byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  // Block align (channelCount * bytesPerSample)
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  // Bits per sample
  view.setUint16(34, bitDepth, true);
  // Data chunk identifier
  writeString(view, 36, 'data');
  // Data chunk length
  view.setUint32(40, bufferLength, true);
  
  /* Convert floating-point samples [-1.0, 1.0] to 16-bit signed integers [-32768, 32767] */
  floatTo16BitPCM(view, 44, channelData);
  
  return new Blob([view], { type: 'audio/wav' });
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * High-level processor wrapper.
 * Intercepts user video/audio files, extracts and downsamples them to a mono 12kHz WAV if the file
 * size exceeds 25 MB or if it is a video file (which contains useless bulky visual tracks).
 */
export async function optimizeMediaFile(
  file: File,
  onProgress: (status: string) => void
): Promise<File> {
  const MAX_SAFE_SIZE = 25 * 1024 * 1024; // 25 MB safety limit
  
  // If the file is small and not a video, keep it untouched to avoid redundant decoding processing
  if (file.size < 64 * 1024) {
    console.log(`File is too small (${file.size} bytes). Skipping downsampling optimization.`);
    return file;
  }

  const isAudioType = file.type.startsWith("audio/");
  const isVideo = (file.type.startsWith("video/") || file.name.toLowerCase().endsWith(".mp4") || file.name.toLowerCase().endsWith(".mov") || (file.name.toLowerCase().endsWith(".webm") && !isAudioType)) && !isAudioType;
  
  // If the file is small and not a video, keep it untouched to avoid redundant decoding processing
  if (file.size <= MAX_SAFE_SIZE && !isVideo) {
    console.log(`File size is ${file.size} bytes (${(file.size / (1024*1024)).toFixed(2)} MB), which is within safe limits. Skipping downsampling.`);
    return file;
  }

  try {
    const actionWord = isVideo ? "Extracting audio track" : "Downsampling audio track";
    onProgress(`${actionWord} client-side...`);
    console.log(`Optimizing file: ${file.name} (${(file.size / (1024*1024)).toFixed(2)} MB)`);
    
    const arrayBuffer = await file.arrayBuffer();
    
    // 12000Hz mono WAV is ~1.4MB of raw audio data per minute, easily supporting large records well under 32MB
    const targetSampleRate = 12000; 
    
    const optimizedBuffer = await downsampleAudio(arrayBuffer, targetSampleRate);
    onProgress("Writing optimized WAV stream...");
    
    const wavBlob = audioBufferToWav(optimizedBuffer);
    
    // Clean original extension and build target name
    const lastDotIndex = file.name.lastIndexOf('.');
    const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
    const optimizedFile = new File([wavBlob], `${baseName}_optimized.wav`, {
      type: "audio/wav",
      lastModified: Date.now()
    });
    
    const originalMB = (file.size / (1024 * 1024)).toFixed(2);
    const optimizedMB = (optimizedFile.size / (1024 * 1024)).toFixed(2);
    console.log(`Optimization succeeded! Compressed ${originalMB} MB down to ${optimizedMB} MB.`);
    onProgress(`Successfully compressed payload: ${originalMB}MB to ${optimizedMB}MB!`);
    
    return optimizedFile;
  } catch (error: any) {
    console.warn("Client-side downsample failed, proceeding with original file:", error);
    onProgress("Local extraction failed, executing default cloud raw transmission...");
    return file;
  }
}
