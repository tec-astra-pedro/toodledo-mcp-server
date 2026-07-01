import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStart = vi.fn().mockResolvedValue(undefined);

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(function () {
    return {
      start: mockStart,
      close: vi.fn(),
      send: vi.fn(),
    };
  }),
}));

vi.mock('./client.js', () => ({
  ToodledoClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

describe('main', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    mockStart.mockClear();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.TOODLEDO_CLIENT_ID;
    delete process.env.TOODLEDO_CLIENT_SECRET;
    delete process.env.TOODLEDO_REFRESH_TOKEN;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it('exits with code 1 when credentials are missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { main } = await import('./index.js');
    await main();

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: TOODLEDO_CLIENT_ID and TOODLEDO_CLIENT_SECRET must be set in environment variables.'
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('starts the server over stdio when credentials are present', async () => {
    process.env.TOODLEDO_CLIENT_ID = 'test-id';
    process.env.TOODLEDO_CLIENT_SECRET = 'test-secret';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { main } = await import('./index.js');
    await main();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Toodledo MCP Server running on stdio');
  });
});
