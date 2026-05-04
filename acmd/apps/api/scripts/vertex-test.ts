import { VertexAI } from '@google-cloud/vertexai';

const project = process.env['ACMD_GCP_PROJECT'] ?? 'gen-lang-client-0707293060';
const location = process.env['ACMD_GCP_LOCATION'] ?? 'us-central1';

console.log(`Testing Vertex AI: project=${project}, location=${location}`);

const vertexAI = new VertexAI({ project, location });
const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

try {
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: 'Say hello in exactly 5 words.' }] }],
  });
  const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  console.log(`\n✅ Vertex AI works! Response: "${text}"`);
  console.log(`Model: gemini-2.5-flash | Provider: Vertex AI`);
} catch (err: any) {
  console.error(`\n❌ Vertex AI failed: ${err.message}`);
}
