import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index';
import { accessAuth, resetJWKSCache, verifyAccessJWT } from './access-auth';

// ── Test helpers ────────────────────────────────────────────────────

const TEAM_DOMAIN = 'testteam.cloudflareaccess.com';
const AUD = 'test-aud-tag-1234567890';
const TEST_EMAIL = 'user@example.com';

/** Build a base64url-encoded string from an object */
function toBase64url(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  const base64 = btoa(json);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Create a fake JWT with the given header and payload (signature is fake) */
function buildFakeJWT(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const h = toBase64url(header);
  const p = toBase64url(payload);
  const s = toBase64url({ fake: 'signature' });
  return `${h}.${p}.${s}`;
}

function validHeader() {
  return { alg: 'RS256', kid: 'test-kid-1', typ: 'JWT' };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    aud: [AUD],
    email: TEST_EMAIL,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000) - 60,
    iss: `https://${TEAM_DOMAIN}`,
    sub: 'user-id-123',
    ...overrides,
  };
}

// ── Hono test app ───────────────────────────────────────────────────

function createTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();

  // Public route
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Protected route group
  const api = new Hono<{
    Bindings: Env;
    Variables: { userEmail: string };
  }>();
  api.use('*', accessAuth);
  api.get('/test', (c) => {
    const email = c.get('userEmail');
    return c.json({ email });
  });
  app.route('/api', api);

  return app;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    QUEUE: {} as Queue,
    BUCKET: {} as R2Bucket,
    KV: {} as KVNamespace,
    ENVIRONMENT: 'test',
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUD,
    WHATSAPP_API_TOKEN: 'test',
    WHATSAPP_PHONE_NUMBER_ID: 'test',
    WHATSAPP_VERIFY_TOKEN: 'test',
    META_APP_SECRET: 'test',
    ...overrides,
  } as Env;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('accessAuth middleware', () => {
  beforeEach(() => {
    resetJWKSCache();
    vi.restoreAllMocks();
  });

  it('returns 403 when Cf-Access-Jwt-Assertion header is missing', async () => {
    const app = createTestApp();
    const env = makeEnv();

    const res = await app.request('/api/test', {}, env);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Access denied' });
  });

  it('returns 403 when JWT is malformed (not 3 parts)', async () => {
    const app = createTestApp();
    const env = makeEnv();

    const res = await app.request(
      '/api/test',
      { headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' } },
      env,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Access denied' });
  });

  it('returns 403 when JWT has invalid base64 in header', async () => {
    const app = createTestApp();
    const env = makeEnv();

    const res = await app.request(
      '/api/test',
      {
        headers: {
          'Cf-Access-Jwt-Assertion': '!!!invalid!!!.payload.signature',
        },
      },
      env,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Access denied' });
  });

  it('returns 403 when JWT algorithm is not RS256', async () => {
    const app = createTestApp();
    const env = makeEnv();

    const token = buildFakeJWT(
      { alg: 'HS256', kid: 'test-kid', typ: 'JWT' },
      validPayload(),
    );

    const res = await app.request(
      '/api/test',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
      env,
    );

    expect(res.status).toBe(403);
  });

  it('returns 403 when CF_ACCESS_TEAM_DOMAIN is not configured', async () => {
    const app = createTestApp();
    const env = makeEnv({ CF_ACCESS_TEAM_DOMAIN: '' });

    const token = buildFakeJWT(validHeader(), validPayload());

    const res = await app.request(
      '/api/test',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
      env,
    );

    expect(res.status).toBe(403);
  });

  it('returns 403 when CF_ACCESS_AUD is not configured', async () => {
    const app = createTestApp();
    const env = makeEnv({ CF_ACCESS_AUD: '' });

    const token = buildFakeJWT(validHeader(), validPayload());

    const res = await app.request(
      '/api/test',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
      env,
    );

    expect(res.status).toBe(403);
  });

  it('does not protect /health route', async () => {
    const app = createTestApp();
    const env = makeEnv();

    const res = await app.request('/health', {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });
});

describe('verifyAccessJWT', () => {
  beforeEach(() => {
    resetJWKSCache();
    vi.restoreAllMocks();
  });

  it('returns null for token with wrong number of parts', async () => {
    const result = await verifyAccessJWT('a.b', TEAM_DOMAIN, AUD);
    expect(result).toBeNull();
  });

  it('returns null for token with empty parts', async () => {
    const result = await verifyAccessJWT('..', TEAM_DOMAIN, AUD);
    expect(result).toBeNull();
  });

  it('returns null when JWKS fetch fails', async () => {
    // Mock global fetch to fail
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    try {
      const token = buildFakeJWT(validHeader(), validPayload());
      const result = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns null when kid does not match any JWKS key', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [{ kty: 'RSA', kid: 'different-kid', n: 'abc', e: 'AQAB' }],
        }),
        { status: 200 },
      ),
    );

    try {
      const token = buildFakeJWT(validHeader(), validPayload());
      const result = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns null for expired JWT', async () => {
    // We need to test the claims validation path. We'll mock the full
    // crypto verification to pass, then check that expired tokens fail.
    const originalFetch = globalThis.fetch;
    const originalSubtle = globalThis.crypto.subtle;

    // Mock JWKS fetch
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              kty: 'RSA',
              kid: 'test-kid-1',
              n: 'sXchDaQebHnPiGvhGPEUBJCBlcybqgzmuJi3jMkTv0KlVZszU0FY9wIRlDlzqt4PgwO4T7Lp-Zhs-vH-HxfpvamJIWkTNBIY8LP-Mv2YiKdEzAETVHSMPMNhMg3R7-b_4Ljfbs-sTbBPsflYyMx5MKH_bAl_t-bLr3WYOzFjxmwjgbMEpBiYdC_mwUYHfccVg8ONs0AUKYBYBAtFpODjzhCMBp6GYlt6cComFUBHCsRPMKlSDbbNLi67Q_gUO8MgSe_GE1NlDG3eCYVEGKaYIqPZPHhFGjE_2yt7_dLrMfmfay7GOlSfRxLgELf4T3wEAZMbDjJVDPMSP5RLHUD0w',
              e: 'AQAB',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    // Mock crypto.subtle to pass signature verification
    const mockSubtle = {
      ...originalSubtle,
      importKey: vi.fn().mockResolvedValue({} as CryptoKey),
      verify: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: mockSubtle,
      writable: true,
      configurable: true,
    });

    try {
      const expiredPayload = validPayload({
        exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
      });
      const token = buildFakeJWT(validHeader(), expiredPayload);
      const result = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        writable: true,
        configurable: true,
      });
    }
  });

  it('returns null for wrong audience', async () => {
    const originalFetch = globalThis.fetch;
    const originalSubtle = globalThis.crypto.subtle;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              kty: 'RSA',
              kid: 'test-kid-1',
              n: 'sXchDaQebHnPiGvhGPEUBJCBlcybqgzmuJi3jMkTv0KlVZszU0FY9wIRlDlzqt4PgwO4T7Lp-Zhs-vH-HxfpvamJIWkTNBIY8LP-Mv2YiKdEzAETVHSMPMNhMg3R7-b_4Ljfbs-sTbBPsflYyMx5MKH_bAl_t-bLr3WYOzFjxmwjgbMEpBiYdC_mwUYHfccVg8ONs0AUKYBYBAtFpODjzhCMBp6GYlt6cComFUBHCsRPMKlSDbbNLi67Q_gUO8MgSe_GE1NlDG3eCYVEGKaYIqPZPHhFGjE_2yt7_dLrMfmfay7GOlSfRxLgELf4T3wEAZMbDjJVDPMSP5RLHUD0w',
              e: 'AQAB',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const mockSubtle = {
      ...originalSubtle,
      importKey: vi.fn().mockResolvedValue({} as CryptoKey),
      verify: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: mockSubtle,
      writable: true,
      configurable: true,
    });

    try {
      const wrongAudPayload = validPayload({ aud: ['wrong-aud'] });
      const token = buildFakeJWT(validHeader(), wrongAudPayload);
      const result = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        writable: true,
        configurable: true,
      });
    }
  });

  it('returns null for wrong issuer', async () => {
    const originalFetch = globalThis.fetch;
    const originalSubtle = globalThis.crypto.subtle;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              kty: 'RSA',
              kid: 'test-kid-1',
              n: 'sXchDaQebHnPiGvhGPEUBJCBlcybqgzmuJi3jMkTv0KlVZszU0FY9wIRlDlzqt4PgwO4T7Lp-Zhs-vH-HxfpvamJIWkTNBIY8LP-Mv2YiKdEzAETVHSMPMNhMg3R7-b_4Ljfbs-sTbBPsflYyMx5MKH_bAl_t-bLr3WYOzFjxmwjgbMEpBiYdC_mwUYHfccVg8ONs0AUKYBYBAtFpODjzhCMBp6GYlt6cComFUBHCsRPMKlSDbbNLi67Q_gUO8MgSe_GE1NlDG3eCYVEGKaYIqPZPHhFGjE_2yt7_dLrMfmfay7GOlSfRxLgELf4T3wEAZMbDjJVDPMSP5RLHUD0w',
              e: 'AQAB',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const mockSubtle = {
      ...originalSubtle,
      importKey: vi.fn().mockResolvedValue({} as CryptoKey),
      verify: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: mockSubtle,
      writable: true,
      configurable: true,
    });

    try {
      const wrongIssPayload = validPayload({
        iss: 'https://wrong-issuer.com',
      });
      const token = buildFakeJWT(validHeader(), wrongIssPayload);
      const result = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        writable: true,
        configurable: true,
      });
    }
  });

  it('returns payload and sets email on valid JWT', async () => {
    const originalFetch = globalThis.fetch;
    const originalSubtle = globalThis.crypto.subtle;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              kty: 'RSA',
              kid: 'test-kid-1',
              n: 'sXchDaQebHnPiGvhGPEUBJCBlcybqgzmuJi3jMkTv0KlVZszU0FY9wIRlDlzqt4PgwO4T7Lp-Zhs-vH-HxfpvamJIWkTNBIY8LP-Mv2YiKdEzAETVHSMPMNhMg3R7-b_4Ljfbs-sTbBPsflYyMx5MKH_bAl_t-bLr3WYOzFjxmwjgbMEpBiYdC_mwUYHfccVg8ONs0AUKYBYBAtFpODjzhCMBp6GYlt6cComFUBHCsRPMKlSDbbNLi67Q_gUO8MgSe_GE1NlDG3eCYVEGKaYIqPZPHhFGjE_2yt7_dLrMfmfay7GOlSfRxLgELf4T3wEAZMbDjJVDPMSP5RLHUD0w',
              e: 'AQAB',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const mockSubtle = {
      ...originalSubtle,
      importKey: vi.fn().mockResolvedValue({} as CryptoKey),
      verify: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: mockSubtle,
      writable: true,
      configurable: true,
    });

    try {
      const payload = validPayload();
      const token = buildFakeJWT(validHeader(), payload);
      const result = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);

      expect(result).not.toBeNull();
      expect(result!.email).toBe(TEST_EMAIL);
      expect(result!.aud).toEqual([AUD]);
      expect(result!.iss).toBe(`https://${TEAM_DOMAIN}`);
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        writable: true,
        configurable: true,
      });
    }
  });

  it('returns null when signature verification fails', async () => {
    const originalFetch = globalThis.fetch;
    const originalSubtle = globalThis.crypto.subtle;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              kty: 'RSA',
              kid: 'test-kid-1',
              n: 'sXchDaQebHnPiGvhGPEUBJCBlcybqgzmuJi3jMkTv0KlVZszU0FY9wIRlDlzqt4PgwO4T7Lp-Zhs-vH-HxfpvamJIWkTNBIY8LP-Mv2YiKdEzAETVHSMPMNhMg3R7-b_4Ljfbs-sTbBPsflYyMx5MKH_bAl_t-bLr3WYOzFjxmwjgbMEpBiYdC_mwUYHfccVg8ONs0AUKYBYBAtFpODjzhCMBp6GYlt6cComFUBHCsRPMKlSDbbNLi67Q_gUO8MgSe_GE1NlDG3eCYVEGKaYIqPZPHhFGjE_2yt7_dLrMfmfay7GOlSfRxLgELf4T3wEAZMbDjJVDPMSP5RLHUD0w',
              e: 'AQAB',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const mockSubtle = {
      ...originalSubtle,
      importKey: vi.fn().mockResolvedValue({} as CryptoKey),
      verify: vi.fn().mockResolvedValue(false), // Signature invalid
    };
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: mockSubtle,
      writable: true,
      configurable: true,
    });

    try {
      const token = buildFakeJWT(validHeader(), validPayload());
      const result = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        writable: true,
        configurable: true,
      });
    }
  });

  it('caches JWKS and reuses on subsequent calls', async () => {
    const originalFetch = globalThis.fetch;
    const originalSubtle = globalThis.crypto.subtle;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            {
              kty: 'RSA',
              kid: 'test-kid-1',
              n: 'sXchDaQebHnPiGvhGPEUBJCBlcybqgzmuJi3jMkTv0KlVZszU0FY9wIRlDlzqt4PgwO4T7Lp-Zhs-vH-HxfpvamJIWkTNBIY8LP-Mv2YiKdEzAETVHSMPMNhMg3R7-b_4Ljfbs-sTbBPsflYyMx5MKH_bAl_t-bLr3WYOzFjxmwjgbMEpBiYdC_mwUYHfccVg8ONs0AUKYBYBAtFpODjzhCMBp6GYlt6cComFUBHCsRPMKlSDbbNLi67Q_gUO8MgSe_GE1NlDG3eCYVEGKaYIqPZPHhFGjE_2yt7_dLrMfmfay7GOlSfRxLgELf4T3wEAZMbDjJVDPMSP5RLHUD0w',
              e: 'AQAB',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock;

    const mockSubtle = {
      ...originalSubtle,
      importKey: vi.fn().mockResolvedValue({} as CryptoKey),
      verify: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: mockSubtle,
      writable: true,
      configurable: true,
    });

    try {
      const token = buildFakeJWT(validHeader(), validPayload());

      // First call — fetches JWKS
      await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call — uses cache
      await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
      expect(fetchMock).toHaveBeenCalledTimes(1); // Still 1
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        writable: true,
        configurable: true,
      });
    }
  });
});
