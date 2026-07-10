// geminiClient.ts — the real network call injected into gemini.ts's preparePage().
// Isolated here (not in gemini.ts) so the prompt/parsing logic stays key-free
// and testable. Free tier only — see CLAUDE.md cost constraints.

import type { ModelCaller } from './gemini';
import { RateLimitError } from './gemini';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-flash-latest';

export const callGemini: ModelCaller = async ({ prompt, imageBase64, imageMimeType }) => {
  if (!API_KEY) {
    throw new Error(
      'Missing EXPO_PUBLIC_GEMINI_API_KEY — add your free Gemini API key to .env (see .env.example).'
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': API_KEY },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }, { inline_data: { mime_type: imageMimeType, data: imageBase64 } }],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Gemini request timed out after 30s — check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    throw new RateLimitError();
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${body}`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Gemini response missing text content');
  }
  return text;
};
