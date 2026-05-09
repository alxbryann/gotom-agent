const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';

export type SynthesizeOptions = {
  text: string;
  voiceId?: string;
  modelId?: string;
};

export async function synthesizeSpeech(
  apiKey: string,
  { text, voiceId, modelId }: SynthesizeOptions,
): Promise<Response> {
  const vid = voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL';
  const mid = modelId ?? process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';

  const url = `${ELEVEN_BASE}/text-to-speech/${vid}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: mid,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`elevenlabs_http_${res.status}: ${errText.slice(0, 500)}`);
  }

  return res;
}
