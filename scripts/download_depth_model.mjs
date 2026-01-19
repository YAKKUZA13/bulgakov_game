import fs from 'node:fs/promises';
import path from 'node:path';

const MODEL_ID = 'Xenova/depth-anything-small-hf';
const REVISION = 'main';

// Keep this minimal for MVP: config + preprocessor + quantized onnx.
const FILES = [
  'config.json',
  // Some pipelines may request this optional file. If missing, some dev servers return index.html (HTML),
  // which then breaks JSON.parse on mobile. We generate an empty one below if it's not present.
  'preprocessor_config.json',
  'onnx/model_quantized.onnx',
  // Optional but small:
  'quantize_config.json',
  // Optional (not present in this repo on HF), but safe as empty object:
  'generation_config.json',
];

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function downloadTo(url, outFile) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status} ${res.statusText}: ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await ensureDir(path.dirname(outFile));
  await fs.writeFile(outFile, buf);
}

async function main() {
  const root = path.resolve(process.cwd(), 'public', 'models', MODEL_ID);
  console.log(`Downloading model files to: ${root}`);

  for (const file of FILES) {
    const out = path.join(root, ...file.split('/'));
    console.log(`- ${file}`);
    if (file === 'generation_config.json') {
      // Not provided by this model; write empty object.
      await ensureDir(path.dirname(out));
      await fs.writeFile(out, '{}\n');
      continue;
    }
    const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file}`;
    await downloadTo(url, out);
  }

  console.log('Done.');
  console.log('You can now load the model from /models/... in the browser (no CORS).');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


