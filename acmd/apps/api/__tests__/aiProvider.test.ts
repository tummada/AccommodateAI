/**
 * Unit tests for AI Provider abstraction layer.
 *
 * Covers:
 *   - getAiProvider(): factory returns correct provider type based on env
 *   - getAiProvider(): returns null when API key is missing (Claude only)
 *   - getAiProvider(): Gemini uses ADC — always returns provider (no key needed)
 *   - getModelForTask(): reads from env, falls back to defaults
 *   - GeminiProvider.generateText(): calls Vertex AI SDK correctly (mocked)
 *   - ClaudeProvider.generateText(): calls Anthropic SDK correctly (mocked)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dotenv/config', () => ({}));

// ---------------------------------------------------------------------------
// Mock Google Vertex AI SDK
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}));

vi.mock('@google-cloud/vertexai', () => {
  return {
    VertexAI: class MockVertexAI {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(_opts?: any) {}
      getGenerativeModel = mockGetGenerativeModel;
    },
  };
});

// ---------------------------------------------------------------------------
// Mock Anthropic SDK
// ---------------------------------------------------------------------------

const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockMessagesCreate };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(_opts?: any) {}
    },
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  getAiProvider,
  getModelForTask,
  GeminiProvider,
  ClaudeProvider,
  resetProviderCache,
  type AiProvider,
} from '../src/services/aiProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_BACKUP: Record<string, string | undefined> = {};
const AI_ENV_KEYS = [
  'ACMD_AI_PROVIDER',
  'ACMD_CLAUDE_API_KEY',
  'ACMD_GCP_PROJECT',
  'ACMD_GCP_LOCATION',
  'ACMD_AI_MODEL_CLASSIFY',
  'ACMD_AI_MODEL_SUGGEST',
  'ACMD_AI_MODEL_LETTER',
];

beforeEach(() => {
  // Backup and clear AI env vars
  for (const key of AI_ENV_KEYS) {
    ENV_BACKUP[key] = process.env[key];
    delete process.env[key];
  }
  vi.clearAllMocks();
  resetProviderCache();

  return () => {
    // Restore env vars
    for (const key of AI_ENV_KEYS) {
      if (ENV_BACKUP[key] !== undefined) {
        process.env[key] = ENV_BACKUP[key];
      } else {
        delete process.env[key];
      }
    }
  };
});

// ---------------------------------------------------------------------------
// getAiProvider() — Factory
// ---------------------------------------------------------------------------

describe('getAiProvider', () => {
  it('should return GeminiProvider when ACMD_AI_PROVIDER=gemini (ADC, no key needed)', () => {
    process.env['ACMD_AI_PROVIDER'] = 'gemini';

    const provider = getAiProvider();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('should return ClaudeProvider when ACMD_AI_PROVIDER=claude and key is set', () => {
    process.env['ACMD_AI_PROVIDER'] = 'claude';
    process.env['ACMD_CLAUDE_API_KEY'] = 'test-claude-key';

    const provider = getAiProvider();
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  it('should default to gemini when ACMD_AI_PROVIDER is not set', () => {
    const provider = getAiProvider();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('should return GeminiProvider even without API key (uses ADC)', () => {
    process.env['ACMD_AI_PROVIDER'] = 'gemini';
    // No ACMD_GEMINI_API_KEY — Gemini uses ADC now

    const provider = getAiProvider();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('should return null when ACMD_AI_PROVIDER=claude but no key', () => {
    process.env['ACMD_AI_PROVIDER'] = 'claude';

    const provider = getAiProvider();
    expect(provider).toBeNull();
  });

  it('should return null for unknown provider', () => {
    process.env['ACMD_AI_PROVIDER'] = 'openai';

    const provider = getAiProvider();
    expect(provider).toBeNull();
  });

  it('should return null when ACMD_CLAUDE_API_KEY is whitespace only', () => {
    process.env['ACMD_AI_PROVIDER'] = 'claude';
    process.env['ACMD_CLAUDE_API_KEY'] = '   ';

    const provider = getAiProvider();
    expect(provider).toBeNull();
  });

  it('should return same instance on second call (cache hit)', () => {
    process.env['ACMD_AI_PROVIDER'] = 'gemini';

    const first = getAiProvider();
    const second = getAiProvider();
    expect(first).toBe(second); // same reference
  });

  it('should return new instance after resetProviderCache()', () => {
    process.env['ACMD_AI_PROVIDER'] = 'gemini';

    const first = getAiProvider();
    resetProviderCache();
    const second = getAiProvider();
    expect(first).not.toBe(second); // different reference
    expect(first).toBeInstanceOf(GeminiProvider);
    expect(second).toBeInstanceOf(GeminiProvider);
  });

  it('should return new instance when GCP project changes', () => {
    process.env['ACMD_AI_PROVIDER'] = 'gemini';
    process.env['ACMD_GCP_PROJECT'] = 'project-1';

    const first = getAiProvider();

    // Change the project — cache should miss
    resetProviderCache();
    process.env['ACMD_GCP_PROJECT'] = 'project-2';
    const second = getAiProvider();

    expect(first).not.toBe(second);
  });

  it('should use default project and location when env vars not set', () => {
    process.env['ACMD_AI_PROVIDER'] = 'gemini';

    const provider = getAiProvider();
    expect(provider).toBeInstanceOf(GeminiProvider);
    // Provider was created — if it didn't throw, defaults worked
  });
});

// ---------------------------------------------------------------------------
// getModelForTask()
// ---------------------------------------------------------------------------

describe('getModelForTask', () => {
  it('should return model from env when ACMD_AI_MODEL_CLASSIFY is set', () => {
    process.env['ACMD_AI_MODEL_CLASSIFY'] = 'custom-model-v1';
    expect(getModelForTask('classify')).toBe('custom-model-v1');
  });

  it('should return model from env when ACMD_AI_MODEL_SUGGEST is set', () => {
    process.env['ACMD_AI_MODEL_SUGGEST'] = 'custom-suggest-v2';
    expect(getModelForTask('suggest')).toBe('custom-suggest-v2');
  });

  it('should return model from env when ACMD_AI_MODEL_LETTER is set', () => {
    process.env['ACMD_AI_MODEL_LETTER'] = 'custom-letter-v3';
    expect(getModelForTask('letter')).toBe('custom-letter-v3');
  });

  it('should return gemini defaults when provider is gemini and no model env', () => {
    process.env['ACMD_AI_PROVIDER'] = 'gemini';

    expect(getModelForTask('classify')).toBe('gemini-2.5-pro');
    expect(getModelForTask('suggest')).toBe('gemini-2.5-pro');
    expect(getModelForTask('letter')).toBe('gemini-2.5-pro');
  });

  it('should return claude defaults when provider is claude and no model env', () => {
    process.env['ACMD_AI_PROVIDER'] = 'claude';

    expect(getModelForTask('classify')).toBe('claude-sonnet-4-6');
    expect(getModelForTask('suggest')).toBe('claude-haiku-4-5-20251001');
    expect(getModelForTask('letter')).toBe('claude-opus-4-6');
  });

  it('should default to gemini models when no provider set', () => {
    expect(getModelForTask('classify')).toBe('gemini-2.5-pro');
  });
});

// ---------------------------------------------------------------------------
// GeminiProvider.generateText()
// ---------------------------------------------------------------------------

describe('GeminiProvider.generateText', () => {
  it('should call Vertex AI SDK with correct parameters and return response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        candidates: [
          { content: { parts: [{ text: 'Gemini says hello' }] } },
        ],
      },
    });

    const provider = new GeminiProvider('test-project', 'us-central1');
    const result = await provider.generateText({
      model: 'gemini-2.5-pro',
      prompt: 'Hello',
      maxTokens: 1024,
    });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith({
      model: 'gemini-2.5-pro',
      generationConfig: { maxOutputTokens: 1024 },
    });
    expect(mockGenerateContent).toHaveBeenCalledWith({
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    });
    expect(result).toEqual({
      text: 'Gemini says hello',
      model: 'gemini-2.5-pro',
      provider: 'gemini',
    });
  });

  it('should throw when Gemini returns empty text', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        candidates: [
          { content: { parts: [{ text: '' }] } },
        ],
      },
    });

    const provider = new GeminiProvider('test-project', 'us-central1');
    await expect(
      provider.generateText({ model: 'gemini-2.5-pro', prompt: 'Hello', maxTokens: 1024 }),
    ).rejects.toThrow('No text content in Gemini response');
  });

  it('should throw when Gemini returns no candidates', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { candidates: [] },
    });

    const provider = new GeminiProvider('test-project', 'us-central1');
    await expect(
      provider.generateText({ model: 'gemini-2.5-pro', prompt: 'Hello', maxTokens: 1024 }),
    ).rejects.toThrow('No text content in Gemini response');
  });

  it('should throw on Gemini API error', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Gemini API error'));

    const provider = new GeminiProvider('test-project', 'us-central1');
    await expect(
      provider.generateText({ model: 'gemini-2.5-pro', prompt: 'Hello', maxTokens: 1024 }),
    ).rejects.toThrow('Gemini API error');
  });
});

// ---------------------------------------------------------------------------
// ClaudeProvider.generateText()
// ---------------------------------------------------------------------------

describe('ClaudeProvider.generateText', () => {
  it('should call Anthropic SDK with correct parameters and return response', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Claude says hello' }],
    });

    const provider = new ClaudeProvider('test-key');
    const result = await provider.generateText({
      model: 'claude-sonnet-4-6',
      prompt: 'Hello',
      maxTokens: 1024,
    });

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result).toEqual({
      text: 'Claude says hello',
      model: 'claude-sonnet-4-6',
      provider: 'claude',
    });
  });

  it('should throw when Claude returns no text block', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'x', name: 'test', input: {} }],
    });

    const provider = new ClaudeProvider('test-key');
    await expect(
      provider.generateText({ model: 'claude-sonnet-4-6', prompt: 'Hello', maxTokens: 1024 }),
    ).rejects.toThrow('No text content in Claude response');
  });

  it('should throw on Anthropic API error', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('Anthropic rate limited'));

    const provider = new ClaudeProvider('test-key');
    await expect(
      provider.generateText({ model: 'claude-sonnet-4-6', prompt: 'Hello', maxTokens: 1024 }),
    ).rejects.toThrow('Anthropic rate limited');
  });
});
