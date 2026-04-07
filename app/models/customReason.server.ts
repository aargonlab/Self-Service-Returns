import prisma from "~/db.server";
import type { Prisma, CustomReason } from "@prisma/client";

/**
 * Returns reasons available for a specific resolution type in a given market.
 * For replacements, excludes reasons where the market is in replacementExcludedMarkets.
 */
export function getReasonResolutions(
  reasons: CustomReason[],
  type: "return" | "replacement",
  marketId?: string,
): CustomReason[] {
  return reasons.filter((reason) => {
    // Check resolution type applicability
    const appliesToType = type === "return" ? reason.appliesToReturn : reason.appliesToReplacement;
    if (!appliesToType) return false;

    // For replacements, check if market is excluded
    if (type === "replacement" && marketId) {
      let excludedMarkets: string[] = [];
      const raw = reason.replacementExcludedMarkets;
      if (Array.isArray(raw)) {
        excludedMarkets = raw as string[];
      } else if (typeof raw === "string") {
        try { excludedMarkets = JSON.parse(raw); } catch { /* ignore parse errors */ }
      }
      if (excludedMarkets.includes(marketId)) {
        return false;
      }
    }

    return true;
  });
}

const DEFAULT_REASONS = [
  // Default return reason codes
  { code: "LAT", label: "Arrived late / Gift order received late", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "UNC", label: "Cannot see clearly / uncomfortable vision", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "CLR", label: "Colour not as expected / pictured", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "DMG", label: "Lightly damaged product", requiresNote: false, appliesToReturn: true, appliesToReplacement: true },
  { code: "DMG", label: "Highly damaged product: Battery leaking, burns, unusual odour or glasses excessively hot", requiresNote: true, appliesToReturn: true, appliesToReplacement: true },
  { code: "STL", label: "Didn't like the style", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "SZL", label: "Fit is too big", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "SZS", label: "Fit is too small", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "FRU", label: "Frame uncomfortable", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "WRG", label: "Incorrect item received (e.g. wrong model)", requiresNote: false, appliesToReturn: true, appliesToReplacement: true },
  { code: "DEL", label: "Lenses are damaged or defective", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "MSG", label: "Missing shipment", requiresNote: false, appliesToReturn: true, appliesToReplacement: true },
  { code: "OIP", label: "Ordered incorrect prescription", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "TRY", label: "Ordered more than one to try on", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "OWR", label: "Ordered wrong product", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "PLI", label: "Prescription lens colour / logo incorrect", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "PNM", label: "Prescription received not matching prescription provided", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "TEC", label: "Not Enough Amplification", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "TEC", label: "Poor Sound Quality", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "TEC", label: "Own Voice is Too Loud", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "TEC", label: "Use via App is Too complex", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "TEC", label: "Battery Life is Too Short", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "TEC", label: "Price Objection", requiresNote: false, appliesToReturn: true, appliesToReplacement: false },
  { code: "WRG", label: "Incorrect item", requiresNote: false, appliesToReturn: false, appliesToReplacement: true },
  { code: "OTHER", label: "Other", requiresNote: true, appliesToReturn: true, appliesToReplacement: true },
];

export async function ensureDefaultReasons(shop: string) {
  const count = await prisma.customReason.count({ where: { shop } });
  if (count > 0) return;

  // Insert each reason individually — catch per-item errors so a single
  // failure doesn't leave the shop with an incomplete set of reasons
  for (let i = 0; i < DEFAULT_REASONS.length; i++) {
    const r = DEFAULT_REASONS[i];
    try {
      await prisma.customReason.create({
        data: {
          shop,
          ...r,
          sortOrder: i * 10,
          markets: [],
        },
      });
    } catch (e) {
      console.error(`[CustomReason] Seed failed:`, e instanceof Error ? e.message : "Unknown error");
    }
  }
}

export async function listReasons(shop: string) {
  return prisma.customReason.findMany({
    where: { shop },
    orderBy: { sortOrder: "asc" },
  });
}

export async function listActiveReasons(shop: string, options?: {
  type?: "return" | "replacement";
  marketId?: string;
  customerVisible?: boolean;
}) {
  // Bug #396 Fix: Replace 'any' type with proper Prisma type
  const where: Prisma.CustomReasonWhereInput = { shop, active: true };

  if (options?.type === "return") {
    where.appliesToReturn = true;
  } else if (options?.type === "replacement") {
    where.appliesToReplacement = true;
  }

  if (options?.customerVisible !== undefined) {
    where.customerVisible = options.customerVisible;
  }

  const reasons = await prisma.customReason.findMany({
    where,
    orderBy: { sortOrder: "asc" },
  });

  // Filter by market
  if (options?.marketId) {
    return reasons.filter((r) => {
      const markets = Array.isArray(r.markets) ? r.markets as string[] : [];
      return markets.length === 0 || markets.includes(options.marketId!);
    });
  }

  // When no market detected, only show global reasons (not market-specific)
  return reasons.filter((r) => {
    const markets = Array.isArray(r.markets) ? r.markets as string[] : [];
    return markets.length === 0;
  });
}

export async function getReason(id: string, shop: string) {
  return prisma.customReason.findFirst({ where: { id, shop } });
}

export async function getReasonsByCode(shop: string, code: string) {
  return prisma.customReason.findMany({ where: { shop, code } });
}

export async function createReason(data: {
  shop: string;
  code: string;
  label: string;
  description?: string;
  appliesToReturn?: boolean;
  appliesToReplacement?: boolean;
  requiresNote?: boolean;
  customerVisible?: boolean;
  sortOrder?: number;
  markets?: string[];
  replacementExcludedMarkets?: string[];
  requiresShoppingEligibility?: boolean;
}) {
  const count = await prisma.customReason.count({ where: { shop: data.shop } });
  if (count >= 100) {
    throw new Error("Maximum of 100 custom reasons per shop");
  }

  // Bug #391 Fix: Validate input length to prevent extremely long strings
  if (data.label && data.label.length > 100) {
    throw new Error("Label must not exceed 100 characters");
  }
  if (data.code && data.code.length > 100) {
    throw new Error("Code must not exceed 100 characters");
  }
  if (data.description && data.description.length > 500) {
    throw new Error("Description must not exceed 500 characters");
  }

  // Sanitize the code
  const sanitizedCode = data.code.toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");

  // Guard against empty sanitized code
  if (!sanitizedCode) {
    throw new Error("Code must contain at least one alphanumeric character");
  }

  return prisma.customReason.create({
    data: {
      shop: data.shop,
      code: sanitizedCode,
      label: data.label,
      description: data.description,
      appliesToReturn: data.appliesToReturn ?? true,
      appliesToReplacement: data.appliesToReplacement ?? false,
      requiresNote: data.requiresNote ?? false,
      customerVisible: data.customerVisible ?? true,
      sortOrder: data.sortOrder ?? 0,
      markets: data.markets ?? [],
      replacementExcludedMarkets: data.replacementExcludedMarkets ?? [],
      requiresShoppingEligibility: data.requiresShoppingEligibility ?? false,
    },
  });
}

export async function updateReason(id: string, shop: string, data: {
  label?: string;
  description?: string;
  appliesToReturn?: boolean;
  appliesToReplacement?: boolean;
  requiresNote?: boolean;
  customerVisible?: boolean;
  active?: boolean;
  sortOrder?: number;
  markets?: string[];
  replacementExcludedMarkets?: string[];
  requiresShoppingEligibility?: boolean;
}) {
  // Validate input length to prevent extremely long strings
  if (data.label && data.label.length > 100) {
    throw new Error("Label must not exceed 100 characters");
  }
  if (data.description && data.description.length > 500) {
    throw new Error("Description must not exceed 500 characters");
  }

  // Build update payload explicitly so Json fields pass Prisma validation
  const updateData: Record<string, unknown> = {};
  if (data.label !== undefined) updateData.label = data.label;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.appliesToReturn !== undefined) updateData.appliesToReturn = data.appliesToReturn;
  if (data.appliesToReplacement !== undefined) updateData.appliesToReplacement = data.appliesToReplacement;
  if (data.requiresNote !== undefined) updateData.requiresNote = data.requiresNote;
  if (data.customerVisible !== undefined) updateData.customerVisible = data.customerVisible;
  if (data.active !== undefined) updateData.active = data.active;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
  if (data.markets !== undefined) updateData.markets = data.markets;
  if (data.replacementExcludedMarkets !== undefined) updateData.replacementExcludedMarkets = data.replacementExcludedMarkets;
  if (data.requiresShoppingEligibility !== undefined) updateData.requiresShoppingEligibility = data.requiresShoppingEligibility;

  return prisma.customReason.update({
    where: { id, shop },
    data: updateData,
  });
}

export async function deleteReason(id: string, shop: string) {
  return prisma.customReason.delete({ where: { id, shop } });
}
