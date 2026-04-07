import prisma from "~/db.server";

export async function createRefundSession(shop: string, email: string, token: string, expiresAt: Date) {
  return prisma.refundSession.create({
    data: { shop, email: email.toLowerCase().trim(), token, expiresAt },
  });
}

export async function getValidSession(shop: string, email: string) {
  return prisma.refundSession.findFirst({
    where: {
      shop,
      email: email.toLowerCase().trim(),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function validateSessionToken(shop: string, token: string): Promise<boolean> {
  // Single-use tokens: atomically delete and validate to prevent TOCTOU race condition
  try {
    const session = await prisma.refundSession.delete({
      where: { token },
    });

    // Validate after atomic delete
    if (session.shop !== shop) return false;
    if (session.expiresAt < new Date()) return false;

    return true;
  } catch (error: unknown) {
    // If delete fails (token not found), return false
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') return false;
    throw error;
  }
}
