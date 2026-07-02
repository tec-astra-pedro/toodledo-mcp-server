import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { URL } from 'url';
import { fileURLToPath } from 'url';
import { exchangeAuthorizationCode } from './oauth.js';
import { createFileTokenStore, TOKEN_ENV_VAR } from './tokenStore.js';

dotenv.config();

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8585/callback';
const DEFAULT_SCOPE = 'basic tasks notes outlines lists write';
const AUTHORIZE_URL = 'https://api.toodledo.com/3/account/authorize.php';

/**
 * Build the authorize URL for the Toodledo OAuth2 flow.
 */
export function buildAuthorizeUrl(options: {
  clientId: string;
  scope?: string;
  redirectUri?: string;
  state?: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    state: options.state ?? crypto.randomUUID(),
    scope: options.scope ?? DEFAULT_SCOPE,
    redirect_uri: options.redirectUri ?? DEFAULT_REDIRECT_URI,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Validate the `state` parameter returned in the OAuth callback matches
 * the one we stored at authorization start. Returns true if valid.
 */
export function validateState(actual: string | null, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < actual.length; i++) {
    result |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Open a URL in the user's default browser. Returns true on success, false if
 * opening failed (caller should print a manual-fallback message).
 */
export async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform as NodeJS.Platform;
  const cmd = platform === 'win32' ? 'start' : platform === 'darwin' ? 'open' : 'xdg-open';

  try {
    await import('child_process').then((cp) => cp.execSync(`${cmd} "${url}"`));
    return true;
  } catch {
    return false;
  }
}

function printHelp(): void {
  console.error(
    'Error: TOODLEDO_CLIENT_ID and TOODLEDO_CLIENT_SECRET must be set.\n' +
      'Register an app at https://api.toodledo.com/3/account/index.php, then copy\n' +
      '.env.example to .env and fill in the values.'
  );
  process.exit(1);
}

export async function runAuthorize(): Promise<void> {
  const clientIdRaw = process.env.TOODLEDO_CLIENT_ID;
  const clientSecretRaw = process.env.TOODLEDO_CLIENT_SECRET;

  if (!clientIdRaw || !clientSecretRaw) printHelp();
  // Narrowed locals so the type checker can track them into nested callbacks.
  const clientId: string = clientIdRaw!;
  const clientSecret: string = clientSecretRaw!;

  // For this CLI entry point we use a temp file-based token store so tests/CI
  // can override the path without affecting the real project root.
  const tokenStore = createFileTokenStore(process.env[TOKEN_ENV_VAR]);

  let state: string;
  try {
    state = crypto.randomUUID();
  } catch {
    // Fallback for environments without WebCrypto (Node < 19 in some configs).
    state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  const authorizeUrl = buildAuthorizeUrl({ clientId, scope: process.env.TOODLEDO_SCOPE, state });

  console.log('Opening browser for Toodledo authorization...');
  const opened = await openBrowser(authorizeUrl);
  if (!opened) {
    console.error(`\nCould not auto-open browser. Please visit this URL manually:\n${authorizeUrl}\n`);
  } else {
    console.log('Waiting for callback on port 8585...\n');
  }

  // Use Node's built-in http module to listen for the OAuth callback.
  const parsedRedirect = new URL(process.env.TOODLEDO_REDIRECT_URI ?? DEFAULT_REDIRECT_URI);
  const port = Number(parsedRedirect.port) || 8585;

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        const code: string | undefined = parsedUrl.searchParams.get('code') as string | undefined;
        const error: string | undefined = parsedUrl.searchParams.get('error') as string | undefined;

        if (parsedUrl.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        if (error) {
          console.error(`\nAuthorization failed: ${error}`);
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`Authorization error: ${error}`);
          server.close();
          process.exit(1);
        }

        if (!code) {
          // state param only — ignore or inform user.
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
          return;
        }

        // Validate state to prevent CSRF.
        const storedState = parsedUrl.searchParams.get('state');
        if (!validateState(storedState ?? null, state)) {
          console.error('\nAuthorization failed: state mismatch (possible CSRF).');
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Invalid state parameter.');
          server.close();
          process.exit(1);
        }

        const credentials = { clientId, clientSecret };
        console.error('Exchanging authorization code for tokens...');
        const tokenResponse = await exchangeAuthorizationCode(
          credentials,
          code,
          parsedRedirect.toString()
        );

        // Persist the refresh token.
        tokenStore.write(tokenResponse.refresh_token);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authorization successful!</h1><p>You can close this tab.</p></body></html>');
        server.close();

        console.log('\n✓ Authorization complete!');
        console.log(`  Refresh token saved to: ${resolveTokenPath()}`);
        console.log('\nTo use with Claude Desktop, add the following to your config:\n');
        printClaudeDesktopSnippet(clientId, clientSecret);
        console.log('\nTo use with Claude Code:\n');
        printClaudeCodeSnippet();

        resolve();
      } catch (err: any) {
        console.error(`\nError during authorization: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
        server.close();
        reject(err);
      }
    });

    server.listen(port, () => {});
    server.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.error(
          `\nError: port ${port} is already in use. Override with TOODLEDO_REDIRECT_URI.\n` +
            `(e.g., http://127.0.0.1:9999/callback)`
        );
        process.exit(1);
      }
      reject(err);
    });
  });
}

function resolveTokenPath(): string {
  const override = process.env[TOKEN_ENV_VAR];
  if (override) return path.resolve(override);

  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      fs.statSync(path.join(dir, 'package.json'));
      return path.join(dir, '.toodledo-token.json');
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return path.join(dir, '.toodledo-token.json');
}

function printClaudeDesktopSnippet(clientId: string, clientSecret: string): void {
  console.error(`  ${JSON.stringify(
    {
      mcpServers: {
        toodledo: {
          command: 'node',
          args: ['/abs/path/to/toodledo-mcp-server/build/index.js'],
          env: { TOODLEDO_CLIENT_ID: clientId, TOODLEDO_CLIENT_SECRET: clientSecret },
        },
      },
    },
    null,
    2
  )}`);
}

function printClaudeCodeSnippet(): void {
  console.error(
    '  claude mcp add toodledo -s user \\\n' +
      '    -e TOODLEDO_CLIENT_ID=... \\\n' +
      '    -e TOODLEDO_CLIENT_SECRET=... \\\n' +
      '    -- node /abs/path/to/toodledo-mcp-server/build/index.js'
  );
}

// CLI entry point — only runs when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runAuthorize().catch((err) => {
    console.error('Fatal error during authorization:', err);
    process.exit(1);
  });
}
