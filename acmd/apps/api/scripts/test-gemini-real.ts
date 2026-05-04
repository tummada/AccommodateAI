/**
 * Real Gemini API Integration Test for AccommodateAI.
 *
 * Tests 3 core AI functions: classify, suggest, letter generation.
 * Calls real Gemini API via Vertex AI — requires Application Default Credentials (ADC).
 *
 * Usage: pnpm --filter @acmd/api test:gemini
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  getAiProvider,
  getModelForTask,
  resetProviderCache,
} from '../src/services/aiProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runTest(
  name: string,
  task: 'classify' | 'suggest' | 'letter',
  prompt: string,
  maxTokens: number,
): Promise<boolean> {
  const provider = getAiProvider();
  if (!provider) {
    console.log(`❌ ${name} — AI provider is null (missing API key?)`);
    return false;
  }

  const model = getModelForTask(task);
  const start = Date.now();

  try {
    const result = await provider.generateText({ model, prompt, maxTokens, timeoutMs: 60_000 });
    const latency = Date.now() - start;

    console.log(`✅ ${name}`);
    console.log(`   model:    ${result.model}`);
    console.log(`   provider: ${result.provider}`);
    console.log(`   response: ${result.text.length} chars`);
    console.log(`   latency:  ${latency}ms`);
    return true;
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ ${name}`);
    console.log(`   model:    ${model}`);
    console.log(`   error:    ${msg}`);
    console.log(`   latency:  ${latency}ms`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== AccommodateAI — Real Gemini API Test ===\n');

  const providerType = process.env['ACMD_AI_PROVIDER'] ?? 'gemini';
  console.log(`Provider: ${providerType}`);
  console.log(`GCP Project: ${process.env['ACMD_GCP_PROJECT'] ?? 'vollos-production (default)'}`);
  console.log(`GCP Location: ${process.env['ACMD_GCP_LOCATION'] ?? 'us-central1 (default)'}`);
  console.log('');

  // Reset cache to pick up fresh env
  resetProviderCache();

  const scenario = 'Employee needs ergonomic chair for back pain. They have a doctor note recommending lumbar support.';

  // Test 1: Classify
  const classifyPrompt = `You are an ADA accommodation classifier. Classify this accommodation request and respond with ONLY valid JSON:
{"category": "ergonomic", "urgency": "medium", "ada_relevant": true, "confidence": 0.95}

Request: ${scenario}`;

  const r1 = await runTest('Classify', 'classify', classifyPrompt, 256);

  // Test 2: Suggest
  const suggestPrompt = `You are an ADA accommodation advisor. Suggest accommodations for this request. Respond with ONLY valid JSON array:
[{"suggestion": "...", "estimated_cost": "...", "implementation_time": "..."}]

Request: ${scenario}`;

  const r2 = await runTest('Suggest', 'suggest', suggestPrompt, 512);

  // Test 3: Letter
  const letterPrompt = `Write a brief formal accommodation approval letter (3-4 sentences) for:
Employee requested an ergonomic chair for back pain. Approved by HR.`;

  const r3 = await runTest('Letter', 'letter', letterPrompt, 512);

  // Summary
  const passed = [r1, r2, r3].filter(Boolean).length;
  console.log(`\n=== Results: ${passed}/3 passed ===`);

  if (passed < 3) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
