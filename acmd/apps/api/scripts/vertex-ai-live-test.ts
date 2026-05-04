/**
 * ACMD-066: Live AI Classification Test via Vertex AI
 *
 * Tests the PRODUCTION code path:
 *   getAiProvider() -> buildClassificationPrompt() -> provider.generateText() -> parseClassificationResponse()
 *
 * Uses classifyCase() directly since it has NO DB dependencies.
 * Loads .env from repo root via dotenv.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from repo root (3 levels up from scripts/)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

import {
  classifyCase,
  buildClassificationPrompt,
  parseClassificationResponse,
  type ClassificationInput,
  type ClassificationOutput,
  type ClassificationResult,
} from '../src/services/aiClassifier.js';
import { getAiProvider, getModelForTask } from '../src/services/aiProvider.js';

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

interface TestCase {
  id: number;
  label: string;
  input: ClassificationInput;
  expectedLawTypes: string[];
}

const TEST_CASES: TestCase[] = [
  {
    id: 1,
    label: 'ADA - Carpal Tunnel (California)',
    input: {
      requestDescription:
        'Employee has been diagnosed with carpal tunnel syndrome and requests an ergonomic keyboard and adjustable desk to continue working as a software developer.',
      employeeName: 'Test Employee 1',
      employeePosition: 'Software Developer',
      employeeDepartment: 'Engineering',
      employeeState: 'California',
      companyState: 'California',
    },
    expectedLawTypes: ['ada', 'multiple'],
  },
  {
    id: 2,
    label: 'PWFA - Pregnancy (Texas)',
    input: {
      requestDescription:
        'Employee is 7 months pregnant and requests more frequent bathroom breaks and ability to sit during shifts that normally require standing.',
      employeeName: 'Test Employee 2',
      employeePosition: 'Retail Associate',
      employeeDepartment: 'Sales',
      employeeState: 'Texas',
      companyState: 'Texas',
    },
    expectedLawTypes: ['pwfa', 'multiple'],
  },
  {
    id: 3,
    label: 'Multiple - Gestational Diabetes (New York)',
    input: {
      requestDescription:
        'Employee developed gestational diabetes during pregnancy and needs schedule modifications for medical appointments and dietary needs, accommodation will be needed after pregnancy as well due to ongoing diabetes management.',
      employeeName: 'Test Employee 3',
      employeePosition: 'Office Manager',
      employeeDepartment: 'Administration',
      employeeState: 'New York',
      companyState: 'New York',
    },
    expectedLawTypes: ['multiple'],
  },
  {
    id: 4,
    label: 'ADA - Drug Rehab (California)',
    input: {
      requestDescription:
        'Employee requests time off for drug rehabilitation program. They have no other disability or medical condition.',
      employeeName: 'Test Employee 4',
      employeePosition: 'Warehouse Worker',
      employeeDepartment: 'Operations',
      employeeState: 'California',
      companyState: 'California',
    },
    expectedLawTypes: ['ada', 'multiple'],
  },
  {
    id: 5,
    label: 'PWFA per se - Basic Pregnancy (Illinois)',
    input: {
      requestDescription:
        'Pregnant employee simply needs access to water and more bathroom breaks during her shift.',
      employeeName: 'Test Employee 5',
      employeePosition: 'Call Center Agent',
      employeeDepartment: 'Customer Service',
      employeeState: 'Illinois',
      companyState: 'Illinois',
    },
    expectedLawTypes: ['pwfa', 'multiple'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('ACMD-066: Live AI Classification Test via Vertex AI');
  console.log('='.repeat(70));

  // Verify provider
  const provider = getAiProvider();
  if (!provider) {
    console.error('FATAL: getAiProvider() returned null. Check ACMD_AI_PROVIDER env var.');
    process.exit(1);
  }

  const model = getModelForTask('classify');
  console.log(`Provider: ${process.env['ACMD_AI_PROVIDER'] ?? 'gemini'}`);
  console.log(`Model:    ${model}`);
  console.log(`Project:  ${process.env['ACMD_GCP_PROJECT'] ?? '(default)'}`);
  console.log(`Location: ${process.env['ACMD_GCP_LOCATION'] ?? 'us-central1'}`);
  console.log('='.repeat(70));

  const results: Array<{ testCase: TestCase; result: ClassificationResult | null; rawText: string; pass: boolean; error?: string }> = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i]!;
    console.log(`\n--- Case ${tc.id}: ${tc.label} ---`);
    console.log(`Expected law_type in: [${tc.expectedLawTypes.join(', ')}]`);

    try {
      // Use individual production functions for visibility into raw response
      const prompt = buildClassificationPrompt(tc.input);
      // Use higher maxTokens — gemini-2.5-pro uses thinking tokens that count against output limit
      const response = await provider.generateText({
        model,
        prompt,
        maxTokens: 8192,
        timeoutMs: 60_000,
      });

      console.log(`\nRaw AI response text (first 500 chars):`);
      console.log(response.text.slice(0, 500));
      console.log(`--- end raw (total ${response.text.length} chars) ---`);

      const parsed = parseClassificationResponse(response.text);
      if (parsed) {
        const pass = tc.expectedLawTypes.includes(parsed.law_type);
        console.log(`\nResult:   ${pass ? 'PASS' : 'FAIL'}`);
        console.log(`law_type: ${parsed.law_type}`);
        console.log(`Full JSON:`);
        console.log(JSON.stringify(parsed, null, 2));
        results.push({ testCase: tc, result: parsed, rawText: response.text, pass });
      } else {
        console.log(`\nFAIL: Could not parse classification from AI response`);
        console.log(`Full raw response:`);
        console.log(response.text);
        results.push({ testCase: tc, result: null, rawText: response.text, pass: false, error: 'JSON parse failed' });
      }
    } catch (err: any) {
      console.error(`ERROR: ${err.message}`);
      results.push({
        testCase: tc,
        result: null,
        rawText: '',
        pass: false,
        error: err.message,
      });
    }

    // Delay between cases (except after last)
    if (i < TEST_CASES.length - 1) {
      console.log('(waiting 3s before next case...)');
      await sleep(3000);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;

  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    const lawType = r.result?.law_type ?? 'N/A';
    console.log(`  Case ${r.testCase.id}: ${status} | law_type=${lawType} | expected=[${r.testCase.expectedLawTypes.join(',')}] | ${r.testCase.label}`);
  }

  console.log(`\nAccuracy: ${passed}/${total} (${Math.round((passed / total) * 100)}%)`);
  console.log(`Provider: ${process.env['ACMD_AI_PROVIDER'] ?? 'gemini'} via Vertex AI SDK`);
  console.log(`Model:    ${model}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
