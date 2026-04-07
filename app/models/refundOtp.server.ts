import prisma from "~/db.server";

export async function getLatestUnusedOtp(shop: string, email: string) {
  return prisma.refundOtp.findFirst({
    where: {
      shop,
      email: email.toLowerCase().trim(),
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function incrementAttempts(otpId: string) {
  return prisma.refundOtp.update({
    where: { id: otpId },
    data: { attempts: { increment: 1 } },
  });
}

export async function markOtpUsed(otpId: string) {
  // Atomic: only marks unused OTPs (prevents race condition)
  return prisma.refundOtp.updateMany({
    where: { id: otpId, used: false },
    data: { used: true },
  });
}
