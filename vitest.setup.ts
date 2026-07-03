import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Safety net: tests that construct a real ToodledoClient without injecting a
// TokenStore fall back to the file-backed store, which would otherwise
// overwrite the real .toodledo-token.json at the repo root (destroying the
// live refresh token, since Toodledo rotates them). Point the store at a
// throwaway temp file for the whole test run; individual tests may still
// override this (tokenStore.test.ts does).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toodledo-test-'));
process.env.TOODLEDO_TOKEN_PATH = path.join(dir, '.toodledo-token.json');

// Disable the response cache globally for tests. Existing client tests use
// msw without a handler for `/account/get.php`, which the cache's validation
// path calls — leaving the cache enabled would break dozens of tests with
// unhandled requests. Cache tests inject an explicit `new ResponseCache({
// ttlMs, now })` instead.
process.env.TOODLEDO_CACHE_TTL = '0';
