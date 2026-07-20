import { getProviderConfig } from "./config";
import {
  generateSpeech as generateElevenLabsSpeech,
  listElevenLabsVoices,
} from "./elevenlabs";
import {
  generatePiperSpeech,
  listPiperVoices,
  PIPER_DEFAULT_VOICE,
  resolvePiperVoice,
} from "./piper";

export async function listTtsVoices() {
  const config = getProviderConfig("tts");
  return config.provider.toLowerCase() === "piper"
    ? listPiperVoices()
    : listElevenLabsVoices();
}

export async function generateSpeech(
  text: string,
  voiceId: string,
  outputPath: string,
) {
  const config = getProviderConfig("tts");
  if (config.provider.toLowerCase() === "piper")
    return generatePiperSpeech(
      text,
      resolvePiperVoice(voiceId || config.model || PIPER_DEFAULT_VOICE),
      outputPath,
    );
  return generateElevenLabsSpeech(text, voiceId, outputPath);
}
