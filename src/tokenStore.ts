import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TOKEN_FILENAME = '.toodledo-token.json';
export const TOKEN_ENV_VAR = 'TOODLEDO_TOKEN_PATH';

interface TokenFile {
  refreshToken: string;
}

/**
 * Resolve the directory that should contain `.toodledo-token.json`.
 *
 * Strategy (matching how MCP hosts launch the process — working directory
 * is unpredictable): walk up from this module's location looking for a
 * `package.json` to identify the project root. Falls back to going two
 * levels up from `src/`. Overridable via `TOODLEDO_TOKEN_PATH`.
 */
function resolveTokenDir(): string {
  const override = process.env[TOKEN_ENV_VAR];
  if (override) return path.dirname(path.resolve(override));

  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      fs.statSync(path.join(dir, 'package.json'));
      return dir;
    } catch {
      // not found yet
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return path.resolve(fileURLToPath(import.meta.url), '..', '..');
}

export interface TokenStore {
  read(): Promise<string | null>;
  write(refreshToken: string): void;
}

/**
 * Create a file-backed token store. The refresh token is persisted as JSON:
 *   { "refreshToken": "..." }
 */
export function createFileTokenStore(tokenPath?: string): TokenStore {
  const resolved = tokenPath ?? process.env[TOKEN_ENV_VAR];
  const dir = resolveTokenDir();
  const filePath = resolved
    ? path.resolve(resolved)
    : path.join(dir, TOKEN_FILENAME);

  return {
    async read(): Promise<string | null> {
      try {
        const raw: string = await fs.promises.readFile(filePath, 'utf-8');
        const data: TokenFile = JSON.parse(raw);
        return data?.refreshToken ?? null;
      } catch (err: any) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },

    write(refreshToken: string): void {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const data: TokenFile = { refreshToken };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    },
  };
}
