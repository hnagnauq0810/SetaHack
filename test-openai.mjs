import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const envFile = readFileSync('.env', 'utf8');

function readEnvValue(name) {
  const line = envFile
    .split(/\r?\n/)
    .findLast((entry) => new RegExp(`^\\s*${name}\\s*=`).test(entry));
  if (!line) return undefined;
  return line
    .replace(new RegExp(`^\\s*${name}\\s*=`), '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

const model = readEnvValue('LD_REPORTING_LLM_MODEL') || 'gpt-4o-mini';
const apiKey = readEnvValue('OPENAI_API_KEY');
const shellApiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error('OPENAI_API_KEY is not loaded. Put it in .env or export it before running this script.');
  process.exit(1);
}

if (shellApiKey && shellApiKey !== apiKey) {
  console.warn(
    [
      'warning: shell OPENAI_API_KEY differs from .env.',
      `shell=${fingerprint(shellApiKey)} .env=${fingerprint(apiKey)}`,
      'pnpm dev inherits the shell value first, so unset the shell key or restart the terminal.',
    ].join('\n'),
  );
}

const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: 'Return only valid JSON: {"ok":true,"message":"LLM works"}',
      },
    ],
  }),
});

console.log('status:', res.status);
const text = await res.text();
try {
  const body = JSON.parse(text);
  if (!res.ok) {
    console.log(
      JSON.stringify(
        {
          error: body.error
            ? {
                message: body.error.message,
                type: body.error.type,
                code: body.error.code,
              }
            : body,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(body.choices?.[0]?.message?.content ?? body);
  }
} catch {
  console.log(text);
}

function fingerprint(value) {
  return `${value.slice(0, 8)}...#${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}
