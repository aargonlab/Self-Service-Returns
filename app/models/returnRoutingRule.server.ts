import prisma from "~/db.server";

export async function listRoutingRules(shop: string) {
  return prisma.returnRoutingRule.findMany({
    where: { shop },
    include: { warehouse: true, carrierAccount: { include: { provider: true } } },
    orderBy: [{ priority: "desc" }, { marketName: "asc" }],
  });
}

export async function getRoutingRule(id: string, shop: string) {
  return prisma.returnRoutingRule.findFirst({
    where: { id, shop },
    include: { warehouse: true, carrierAccount: { include: { provider: true } } },
  });
}

export async function createRoutingRule(shop: string, data: {
  marketId?: string | null;
  marketName?: string | null;
  warehouseId: string;
  carrierAccountId?: string | null;
  returnInstructions?: string | null;
  priority?: number;
}) {
  // Verify warehouse belongs to same shop
  const warehouse = await prisma.returnWarehouse.findFirst({
    where: { id: data.warehouseId, shop },
  });
  if (!warehouse) throw new Error("Warehouse not found");

  // M-DI3: Prevent multiple null marketId rules for same shop
  // (SQL allows multiple NULLs in unique constraints)
  const normalizedMarketId = data.marketId || null;
  if (normalizedMarketId === null) {
    const existingDefaultRule = await prisma.returnRoutingRule.findFirst({
      where: { shop, marketId: null },
    });
    if (existingDefaultRule) {
      throw new Error("A default routing rule (marketId = null) already exists for this shop. Please update the existing rule instead.");
    }
  }

  return prisma.returnRoutingRule.create({
    data: {
      shop,
      marketId: normalizedMarketId,
      marketName: data.marketName || null,
      warehouseId: data.warehouseId,
      carrierAccountId: data.carrierAccountId || null,
      returnInstructions: data.returnInstructions || null,
      priority: data.priority || 0,
    },
    include: { warehouse: true, carrierAccount: { include: { provider: true } } },
  });
}

export async function updateRoutingRule(id: string, shop: string, data: {
  marketId?: string | null;
  marketName?: string | null;
  warehouseId?: string;
  carrierAccountId?: string | null;
  returnInstructions?: string | null;
  priority?: number;
  active?: boolean;
}) {
  const rule = await prisma.returnRoutingRule.findFirst({ where: { id, shop } });
  if (!rule) throw new Error("Routing rule not found");

  // Validate warehouse belongs to same shop
  if (data.warehouseId) {
    const warehouse = await prisma.returnWarehouse.findFirst({
      where: { id: data.warehouseId, shop },
    });
    if (!warehouse) throw new Error("Warehouse not found or does not belong to this shop");
  }

  // M-DI3: If changing marketId to null, check if another default rule exists
  if (data.marketId !== undefined && data.marketId === null && rule.marketId !== null) {
    const existingDefaultRule = await prisma.returnRoutingRule.findFirst({
      where: { shop, marketId: null, id: { not: id } },
    });
    if (existingDefaultRule) {
      throw new Error("A default routing rule (marketId = null) already exists for this shop. Please delete or update the existing default rule first.");
    }
  }

  return prisma.returnRoutingRule.update({
    where: { id },
    data,
    include: { warehouse: true, carrierAccount: { include: { provider: true } } },
  });
}

export async function deleteRoutingRule(id: string, shop: string) {
  const rule = await prisma.returnRoutingRule.findFirst({
    where: { id, shop },
  });
  if (!rule) {
    throw new Error("Routing rule not found");
  }
  return prisma.returnRoutingRule.delete({
    where: { id },
  });
}

/**
 * Resolve the routing rule for a given market.
 * Falls back to default rule (marketId = null) if no specific rule found.
 *
 * Note: This is a read-only resolution. If rules are updated concurrently,
 * the worst case is returning a slightly stale rule, which self-corrects on next request.
 * Row locking is not critical for read-only queries where eventual consistency is acceptable.
 */
export async function resolveRoutingRule(shop: string, marketId: string | null) {
  return prisma.$transaction(async (tx) => {
    // Try exact market match
    if (marketId) {
      const marketMatch = await tx.returnRoutingRule.findFirst({
        where: { shop, marketId, active: true },
        include: { warehouse: true, carrierAccount: { include: { provider: true } } },
        orderBy: { priority: "desc" },
      });
      if (marketMatch) return marketMatch;
    }

    // Fall back to default rule (marketId = null)
    const defaultRule = await tx.returnRoutingRule.findFirst({
      where: { shop, marketId: null, active: true },
      include: { warehouse: true, carrierAccount: { include: { provider: true } } },
      orderBy: { priority: "desc" },
    });

    return defaultRule;
  });
}
