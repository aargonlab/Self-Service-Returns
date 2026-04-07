import prisma from "~/db.server";

export async function createReplacementInstruction(data: {
  returnRequestId: string;
  replacementItems: Array<{ productId?: string; variantId?: string; title: string; quantity: number }>;
  notes?: string;
}) {
  // Validate replacement items
  if (!data.replacementItems || data.replacementItems.length === 0) {
    throw new Error("At least one replacement item is required");
  }
  if (data.replacementItems.length > 50) {
    throw new Error("Too many replacement items (max 50)");
  }
  for (const item of data.replacementItems) {
    if (!item.title || item.title.length > 500) throw new Error("Replacement item title is required and must not exceed 500 characters");
    if (!item.quantity || item.quantity < 1 || item.quantity > 999) throw new Error("Replacement item quantity must be between 1 and 999");
  }

  return prisma.replacementInstruction.create({
    data: {
      returnRequestId: data.returnRequestId,
      replacementItems: data.replacementItems,
      status: "PENDING",
      notes: data.notes,
    },
  });
}

export async function getReplacementInstruction(returnRequestId: string, shop: string) {
  return prisma.replacementInstruction.findFirst({
    where: {
      returnRequestId,
      returnRequest: { shop },
    },
    include: { returnRequest: { select: { shop: true } } },
  });
}

export async function updateReplacementStatus(returnRequestId: string, shop: string, data: {
  status: string;
  shopifyNewOrderId?: string;
  notes?: string;
}) {
  // Verify shop ownership before updating
  const instruction = await prisma.replacementInstruction.findUnique({
    where: { returnRequestId },
    include: { returnRequest: { select: { shop: true } } },
  });

  if (!instruction || instruction.returnRequest.shop !== shop) {
    throw new Error("Replacement instruction not found or access denied");
  }

  return prisma.replacementInstruction.update({
    where: { returnRequestId },
    data,
  });
}
