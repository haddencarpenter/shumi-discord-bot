// Prefer auto-generated version, fallback to env vars, then dev timestamp
import { readFileSync } from 'node:fs';

let version, builtAt;
try {
  const gen = JSON.parse(readFileSync('./src/version.generated.json', 'utf8'));
  version = gen.git;
  builtAt = gen.builtAt;
} catch {
  // Fallback to manual env vars or dev timestamp
  version = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ||
            process.env.GIT_SHA?.slice(0, 7) ||
            `dev-${new Date().toISOString()}`;
}

export { version };
export const shortVersion = version.slice(0, 12);
export const startedAt = new Date().toISOString();
export const buildTime = builtAt;