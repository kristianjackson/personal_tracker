import { createMiddleware } from 'hono/factory';
import type { Env } from '../index';

/**
 * Cloudflare Access JWT validation middleware.
 *
 * Validates the `Cf-Access-Jwt-Assertion` header on every request to
 * protected routes. Uses the Web Crypto API (available in Workers) to
 * verify RS256 signatures against the JWKS published by the Access
 * team domain.
 *
 * On success, sets `userEmail` on the Hono context for downstream handlers.
 * On failure, returns 403 with a JSON error body.
 *
 * Validates: NFR-SEC-001, DD-005, Section 9.2
 */

// ── Types ───────────────────────────────────────────────────────────

interface JWK {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

interface JWKS {
  keys: JWK[];
}

interface JWTHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface JWTPayload {
  aud: string[];
  email: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
  [key: string]: unknown;
}

// ── JWKS cache ──────────────────────────────────────────────────────

interface CachedJWKS {
  keys: JWKS;
  fetchedAt: number;
}

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let jwksCache: CachedJWKS | null = null;

/**
 * Fetch JWKS from the Cloudflare Access certs endpoint.
 * Caches in a module-level variable with a 5-minute TTL.
 */
export async function fetchJWKS(teamDomain: string): Promise<JWKS> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }

  const keys = (await response.json()) as JWKS;
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

/**
 * Reset the JWKS cache. Exposed for testing.
 */
export function resetJWKSCache(): void {
  jwksCache = null;
}

// ── JWT helpers ─────────────────────────────────────────────────────

/** Base64url decode to Uint8Array */
function base64urlDecode(input: string): Uint8Array {
  // Convert base64url to base64
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to multiple of 4
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Decode a JWT part (header or payload) from base64url to JSON */
function decodeJWTPart<T>(part: string): T {
  const bytes = base64urlDecode(part);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

/**
 * Import a JWK as a CryptoKey for RS256 verification.
 */
async function importJWK(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      ext: true,
    },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

/**
 * Verify a JWT token against the JWKS from Cloudflare Access.
 *
 * Returns the decoded payload on success, or null on any failure.
 */
export async function verifyAccessJWT(
  token: string,
  teamDomain: string,
  expectedAud: string,
): Promise<JWTPayload | null> {
  // Split token into parts
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to get kid
  let header: JWTHeader;
  try {
    header = decodeJWTPart<JWTHeader>(headerB64);
  } catch {
    return null;
  }

  if (header.alg !== 'RS256') {
    return null;
  }

  // Fetch JWKS and find matching key
  let jwks: JWKS;
  try {
    jwks = await fetchJWKS(teamDomain);
  } catch {
    return null;
  }

  const matchingKey = jwks.keys.find((k) => k.kid === header.kid);
  if (!matchingKey) {
    return null;
  }

  // Import key and verify signature
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await importJWK(matchingKey);
  } catch {
    return null;
  }

  const signedContent = new TextEncoder().encode(
    `${headerB64}.${payloadB64}`,
  );
  const signature = base64urlDecode(signatureB64).buffer as ArrayBuffer;

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signature,
      signedContent,
    );
  } catch {
    return null;
  }

  if (!valid) {
    return null;
  }

  // Decode and validate claims
  let payload: JWTPayload;
  try {
    payload = decodeJWTPart<JWTPayload>(payloadB64);
  } catch {
    return null;
  }

  // Validate audience
  const audArray = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audArray.includes(expectedAud)) {
    return null;
  }

  // Validate expiration
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    return null;
  }

  // Validate issuer
  const expectedIssuer = `https://${teamDomain}`;
  if (payload.iss !== expectedIssuer) {
    return null;
  }

  return payload;
}

// ── Hono middleware ─────────────────────────────────────────────────

/**
 * Cloudflare Access authentication middleware for Hono.
 *
 * Apply to route groups that require dashboard authentication.
 * Leaves /health and /webhook/* unprotected.
 */
export const accessAuth = createMiddleware<{
  Bindings: Env;
  Variables: { userEmail: string };
}>(
  async (c, next) => {
    const token = c.req.header('Cf-Access-Jwt-Assertion');

    if (!token) {
      return c.json({ error: 'Access denied' }, 403);
    }

    const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
    const aud = c.env.CF_ACCESS_AUD;

    if (!teamDomain || !aud) {
      console.error('CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD not configured');
      return c.json({ error: 'Access denied' }, 403);
    }

    const payload = await verifyAccessJWT(token, teamDomain, aud);

    if (!payload) {
      return c.json({ error: 'Access denied' }, 403);
    }

    c.set('userEmail', payload.email);
    await next();
  },
);
