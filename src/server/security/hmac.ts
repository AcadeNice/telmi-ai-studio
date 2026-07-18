import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export function signN8nRequest(
  body: string,
  timestamp: string,
  nonce: string = randomUUID(),
) {
  const secret = process.env.N8N_SHARED_SECRET;
  if (!secret || secret.length < 24)
    throw new Error("N8N_SHARED_SECRET must contain at least 24 characters.");
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");
  return { timestamp, nonce, signature };
}

export function verifyN8nSignature(
  body: string,
  timestamp: string,
  nonce: string,
  signature: string,
  now = Date.now(),
) {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || Math.abs(now - parsed) > 5 * 60_000)
    return false;
  const expected = signN8nRequest(body, timestamp, nonce).signature;
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
