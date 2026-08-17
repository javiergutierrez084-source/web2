/**
 * Calcula un checksum SHA-256 de cualquier objeto serializable.
 */
export async function computeChecksum(data: unknown): Promise<string> {
  const json = JSON.stringify(data);

  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);

  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifica que el checksum coincida.
 */
export async function verifyChecksum(
  data: unknown,
  expectedChecksum: string
): Promise<boolean> {
  const actual = await computeChecksum(data);
  return actual === expectedChecksum;
}