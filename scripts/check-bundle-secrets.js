// Release check (spec 07 §4): fails if the client build contains an API key or a server-side
// env name. Runs after every build; on the host the real key values are in the environment, so
// those are searched for too. Usage: node scripts/check-bundle-secrets.js [dir=dist]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const SECRET_ENV = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'];
const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  ...SECRET_ENV.map((n) => new RegExp(n)),
];

/** Values from the environment and any local env files, so a leaked real key is caught. */
function secretValues() {
  const values = SECRET_ENV.map((name) => process.env[name]);
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(["']?)(.*?)\2\s*$/.exec(line);
      if (match && SECRET_ENV.includes(match[1] ?? '')) values.push(match[3]);
    }
  }
  return values.filter((v) => typeof v === 'string' && v.length >= 8);
}

function* files(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

const values = secretValues();
const hits = [];
let scanned = 0;
for (const file of files(dir)) {
  const text = readFileSync(file).toString('latin1');
  scanned += 1;
  for (const pattern of PATTERNS) if (pattern.test(text)) hits.push(`${file}: matches ${pattern}`);
  if (values.some((v) => text.includes(v))) hits.push(`${file}: contains a configured API key`);
}

if (hits.length > 0) {
  console.error(`Secrets found in ${dir}:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(
  `No secrets in ${scanned} files under ${dir} (${values.length} configured key values checked).`,
);
