import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes has no WebCrypto, and supabase-js builds its OAuth sign-in code
 * challenge with `crypto.subtle.digest('SHA-256', ...)`. Without it the
 * challenge silently falls back to "plain", which anyone who sees the redirect
 * can replay. This hands it expo-crypto's SHA-256 so the challenge is S256.
 *
 * Only what supabase-js uses is provided: `getRandomValues` and
 * `subtle.digest`. A runtime that already has WebCrypto is left alone.
 */
type DigestAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

const g = globalThis as unknown as {
  crypto?: { getRandomValues?: unknown; subtle?: unknown };
};

if (!g.crypto?.subtle) {
  g.crypto = {
    ...(g.crypto ?? {}),
    getRandomValues: g.crypto?.getRandomValues ?? ExpoCrypto.getRandomValues,
    subtle: {
      digest: (algorithm: DigestAlgorithm | { name: DigestAlgorithm }, data: BufferSource) => {
        const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
        return ExpoCrypto.digest(name as ExpoCrypto.CryptoDigestAlgorithm, data);
      },
    },
  };
}
