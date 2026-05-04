/**
 * AI Provider Abstraction Layer for AccommodateAI.
 *
 * Supports both Claude (Anthropic) and Gemini (Google Vertex AI) as AI providers.
 * Provider selection is controlled via ACMD_AI_PROVIDER env var.
 *
 * SECURITY:
 *   - Claude uses API key from env, never logged or exposed
 *   - Gemini uses Application Default Credentials (ADC) — no API key needed
 *   - This is a pure abstraction — no DB imports, no business logic
 */

import Anthropic from '@anthropic-ai/sdk';
import { VertexAI } from '@google-cloud/vertexai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiResponse {
  text: string;
  model: string;
  provider: 'claude' | 'gemini';
}

export interface AiProviderOptions {
  model: string;
  prompt: string;
  maxTokens: number;
  timeoutMs?: number;
}

export interface AiProvider {
  generateText(options: AiProviderOptions): Promise<AiResponse>;
}

// ---------------------------------------------------------------------------
// Claude Provider
// ---------------------------------------------------------------------------

export class ClaudeProvider implements AiProvider {
  private client: Anthropic;

  constructor(apiKey: string, timeoutMs?: number) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs ?? 30_000 });
  }

  async generateText(options: AiProviderOptions): Promise<AiResponse> {
    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [{ role: 'user', content: options.prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content in Claude response');
    }

    return {
      text: textBlock.text,
      model: options.model,
      provider: 'claude',
    };
  }
}

// ---------------------------------------------------------------------------
// Gemini Provider
// ---------------------------------------------------------------------------

export class GeminiProvider implements AiProvider {
  private vertexAI: VertexAI;

  constructor(project?: string, location?: string) {
    this.vertexAI = new VertexAI({
      project: project ?? process.env['ACMD_GCP_PROJECT'] ?? 'vollos-production',
      location: location ?? process.env['ACMD_GCP_LOCATION'] ?? 'us-central1',
    });
  }

  async generateText(options: AiProviderOptions): Promise<AiResponse> {
    const model = this.vertexAI.getGenerativeModel({
      model: options.model,
      generationConfig: {
        maxOutputTokens: options.maxTokens,
      },
    });

    const timeoutMs = options.timeoutMs ?? 30_000;

    // Wrap generateContent with a timeout — clearTimeout in finally to avoid orphaned timers
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Gemini request timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });

      const resultPromise = model.generateContent({ contents: [{ role: 'user', parts: [{ text: options.prompt }] }] });
      const result = await Promise.race([resultPromise, timeoutPromise]);

      const candidates = result.response?.candidates;
      const text = candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      if (!text) {
        throw new Error('No text content in Gemini response');
      }

      return {
        text,
        model: options.model,
        provider: 'gemini',
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory (cached — one SDK client per config)
// ---------------------------------------------------------------------------

let cachedProvider: AiProvider | null | undefined; // undefined = not yet initialized
let cachedProviderKey = '';

/**
 * Reset the cached provider instance.
 * Exported for testing — call in beforeEach when env vars change.
 */
export function resetProviderCache(): void {
  cachedProvider = undefined;
  cachedProviderKey = '';
}

/**
 * Get the AI provider based on ACMD_AI_PROVIDER env var.
 * Returns null if no API key is configured for Claude, or unknown provider.
 * Gemini uses ADC (Application Default Credentials) — no API key needed.
 * Caches the instance — returns same object while env config is unchanged.
 */
export function getAiProvider(): AiProvider | null {
  const providerType = process.env['ACMD_AI_PROVIDER'] ?? 'gemini';

  // Build a cache key that reflects configuration changes
  let cacheKey: string;
  if (providerType === 'claude') {
    const key = process.env['ACMD_CLAUDE_API_KEY']?.trim();
    cacheKey = `claude:${key ?? ''}`;
  } else if (providerType === 'gemini') {
    const project = process.env['ACMD_GCP_PROJECT'] ?? 'vollos-production';
    const location = process.env['ACMD_GCP_LOCATION'] ?? 'us-central1';
    cacheKey = `gemini:${project}:${location}`;
  } else {
    cacheKey = `unknown:${providerType}`;
  }

  if (cachedProvider !== undefined && cachedProviderKey === cacheKey) {
    return cachedProvider;
  }

  let newProvider: AiProvider | null = null;

  if (providerType === 'claude') {
    const key = process.env['ACMD_CLAUDE_API_KEY']?.trim();
    if (!key) {
      console.warn('[AI Provider] ACMD_CLAUDE_API_KEY not set — returning null');
    } else {
      newProvider = new ClaudeProvider(key);
    }
  } else if (providerType === 'gemini') {
    // Gemini uses ADC — no API key needed
    newProvider = new GeminiProvider();
  } else {
    console.warn(`[AI Provider] Unknown provider "${providerType}" — returning null`);
  }

  cachedProviderKey = cacheKey;
  cachedProvider = newProvider;
  return cachedProvider;
}

// ---------------------------------------------------------------------------
// Model Config Helper
// ---------------------------------------------------------------------------

const GEMINI_DEFAULTS: Record<string, string> = {
  classify: 'gemini-2.5-pro',
  suggest: 'gemini-2.5-pro',
  letter: 'gemini-2.5-pro',
};

const CLAUDE_DEFAULTS: Record<string, string> = {
  classify: 'claude-sonnet-4-6',
  suggest: 'claude-haiku-4-5-20251001',
  letter: 'claude-opus-4-6',
};

/**
 * Get the AI model for a specific task type.
 * Reads from ACMD_AI_MODEL_CLASSIFY / SUGGEST / LETTER env vars.
 * Falls back to provider-specific defaults.
 */
export function getModelForTask(task: 'classify' | 'suggest' | 'letter'): string {
  const envKey = `ACMD_AI_MODEL_${task.toUpperCase()}`;
  const envValue = process.env[envKey];
  if (envValue) return envValue;

  const provider = process.env['ACMD_AI_PROVIDER'] ?? 'gemini';
  const defaults = provider === 'claude' ? CLAUDE_DEFAULTS : GEMINI_DEFAULTS;
  return defaults[task] ?? 'gemini-2.5-pro';
}
