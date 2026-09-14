import { timingSafeEqual } from "node:crypto";

/** Machine-only endpoints use a separate secret, never a user session. */
export function hasInternalSecret(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const actualBytes = new TextEncoder().encode(header);
  const expectedBytes = new TextEncoder().encode(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
