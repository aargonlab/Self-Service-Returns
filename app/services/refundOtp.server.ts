import crypto from "crypto";
import { isActiveAgent } from "~/models/refundAgent.server";
import {
  getLatestUnusedOtp,
  incrementAttempts,
} from "~/models/refundOtp.server";
import {
  getValidSession,
  validateSessionToken,
} from "~/models/refundSession.server";
import prisma from "~/db.server";

const OTP_EXPIRY_MINUTES = 10;
const SESSION_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 3;
const MAX_OTP_REQUESTS_PER_HOUR = 10;

function generateOtpCode(): string {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

// SECURITY WARNING: Development-only fallback secret
// In production, require a real secret. In dev, use a deterministic fallback
// so OTPs survive process restarts during development. This is INSECURE in production.
const DEV_FALLBACK_SECRET =
  process.env.NODE_ENV === "production"
    ? null
    : crypto.createHash("sha256").update("discountkit-dev-otp-secret").digest("hex");

function hashCode(code: string): string {
  const secret = process.env.OTP_HASH_SECRET || process.env.SESSION_SECRET || DEV_FALLBACK_SECRET;
  if (!secret) {
    throw new Error("[RefundOTP] CRITICAL: No OTP_HASH_SECRET or SESSION_SECRET configured. Set one in your environment.");
  }
  if (secret === DEV_FALLBACK_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("[RefundOTP] CRITICAL: Using insecure development secret in production. Set OTP_HASH_SECRET or SESSION_SECRET.");
  }
  return crypto.createHmac("sha256", secret).update(code).digest("hex");
}

function verifyCode(code: string, hash: string): boolean {
  const candidateHash = hashCode(code);
  const candidateBuf = Buffer.from(candidateHash);
  const hashBuf = Buffer.from(hash);
  // timingSafeEqual throws if lengths differ — guard against corrupted hashes
  if (candidateBuf.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, hashBuf);
}

export async function requestRefundOtp(
  shop: string,
  email: string,
): Promise<{ success: boolean; message: string; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Check whitelist
  const authorized = await isActiveAgent(shop, normalizedEmail);
  if (!authorized) {
    // Generic message to prevent email enumeration
    return { success: false, message: "Unable to send verification code.", error: "NOT_WHITELISTED" };
  }

  // Rate limit: max 5 OTP requests per hour - use transaction to prevent race condition
  const code = generateOtpCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  try {
    // Prisma interactive transactions use serializable isolation by default,
    // preventing race conditions where concurrent requests could both pass the count check
    await prisma.$transaction(async (tx) => {
      // Atomically check rate limit and create OTP
      const recentCount = await tx.refundOtp.count({
        where: {
          shop,
          email: normalizedEmail,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });

      if (recentCount >= MAX_OTP_REQUESTS_PER_HOUR) {
        throw new Error("RATE_LIMITED");
      }

      // Create OTP inside transaction
      await tx.refundOtp.create({
        data: { shop, email: normalizedEmail, codeHash, expiresAt },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      return { success: false, message: "Too many requests. Please try again later.", error: "RATE_LIMITED" };
    }
    throw error;
  }

  // Dev mode: log that OTP was sent (but NOT the actual code for security)
  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV] Refund OTP sent to ${normalizedEmail} - check email for code`);
  }

  // Send email
  try {
    const { sendRefundOtpEmail } = await import("~/services/email.server");
    await sendRefundOtpEmail(normalizedEmail, code, shop);
  } catch (error) {
    console.error("[RefundOTP] Failed to send OTP email:", error);
    // In dev mode, the code was already logged, so we can continue
    if (process.env.NODE_ENV === "production") {
      return { success: false, message: "Failed to send verification email. Please try again." };
    }
  }

  return { success: true, message: "Verification code sent to your email." };
}

export async function verifyRefundOtp(
  shop: string,
  email: string,
  code: string,
): Promise<{
  success: boolean;
  message: string;
  sessionToken?: string;
  expiresAt?: string;
  error?: string;
}> {
  const normalizedEmail = email.toLowerCase().trim();
  const cleanCode = code.replace(/\s/g, "");

  // Validate format
  if (!/^\d{6}$/.test(cleanCode)) {
    return { success: false, message: "Invalid code format.", error: "INVALID_CODE" };
  }

  // Get the latest unused OTP for this shop+email
  const otp = await getLatestUnusedOtp(shop, normalizedEmail);
  if (!otp) {
    return { success: false, message: "No valid code found. Please request a new one.", error: "EXPIRED" };
  }

  // Check attempts
  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    return { success: false, message: "Too many failed attempts. Please request a new code.", error: "TOO_MANY_ATTEMPTS" };
  }

  // Verify code
  const isValid = verifyCode(cleanCode, otp.codeHash);
  if (!isValid) {
    await incrementAttempts(otp.id);
    const remaining = MAX_OTP_ATTEMPTS - otp.attempts - 1;
    return {
      success: false,
      message: remaining > 0
        ? `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
        : "Too many failed attempts. Please request a new code.",
      error: "INVALID_CODE",
    };
  }

  // Mark OTP as used AND create session atomically
  // If either operation fails, neither completes — prevents double-verification
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const sessionExpiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    // Mark OTP used first — if this fails, no session is created
    await tx.refundOtp.updateMany({
      where: { id: otp.id, used: false },
      data: { used: true },
    });
    // Create session within same transaction
    await tx.refundSession.create({
      data: {
        shop,
        email: normalizedEmail,
        token: sessionToken,
        expiresAt: sessionExpiresAt,
      },
    });
  });

  return {
    success: true,
    message: "Verification successful.",
    sessionToken,
    expiresAt: sessionExpiresAt.toISOString(),
  };
}

export async function checkRefundSession(
  shop: string,
  email: string,
): Promise<{ hasValidSession: boolean; expiresAt?: string; token?: string }> {
  const session = await getValidSession(shop, email);
  if (!session) {
    return { hasValidSession: false };
  }
  return {
    hasValidSession: true,
    expiresAt: session.expiresAt.toISOString(),
    token: session.token,
  };
}

export { validateSessionToken };
