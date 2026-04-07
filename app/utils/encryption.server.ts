import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
  // Use a deployment-specific salt if available, falling back to a constant for backward compatibility
  const salt = process.env.ENCRYPTION_SALT || "discountkit-credentials";
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY environment variable is required in production");
    }
    // SECURITY WARNING: Development-only fallback key
    // In development, use a deterministic key so encryption/decryption works without configuration.
    // This is NOT secure — credentials encrypted with this key are trivially decryptable.
    // NEVER use this in production. Set CREDENTIALS_ENCRYPTION_KEY environment variable.
    console.warn("[Encryption] WARNING: Using deterministic development fallback key. This is INSECURE. Set CREDENTIALS_ENCRYPTION_KEY for production.");
    return scryptSync("dev-only-insecure-key", salt, 32);
  }
  // Derive a 32-byte key from the secret using scrypt
  return scryptSync(secret, salt, 32);
}

/**
 * Encrypt a plaintext string. Returns base64-encoded ciphertext with IV and auth tag prepended.
 * Format: base64(iv + authTag + ciphertext)
 */
export function encryptCredential(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Prepend IV + tag to ciphertext
  const combined = Buffer.concat([iv, tag, encrypted]);
  return `enc:${combined.toString("base64")}`;
}

/**
 * Decrypt a credential string. If the string doesn't start with "enc:", assume it's plaintext (migration compat).
 */
export function decryptCredential(ciphertext: string): string {
  if (!ciphertext) return ciphertext;
  // Backward compatibility: if not encrypted, return as-is
  if (!ciphertext.startsWith("enc:")) return ciphertext;

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(ciphertext.slice(4), "base64");
    const iv = combined.subarray(0, IV_LENGTH);
    const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt credential. The encryption key may have changed or data is corrupted.");
  }
}
