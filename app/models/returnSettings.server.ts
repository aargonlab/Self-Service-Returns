import prisma from "~/db.server";
import type { Prisma } from "@prisma/client";

const DEFAULT_REASONS: string[] = [
  "DOESNT_FIT",
  "NOT_AS_DESCRIBED",
  "ARRIVED_DAMAGED",
  "WRONG_ITEM",
  "CHANGED_MIND",
  "QUALITY_NOT_EXPECTED",
  "OTHER",
];

export async function getSettings(shop: string) {
  const settings = await prisma.returnSettings.upsert({
    where: { shop },
    create: {
      shop,
      returnWindowDays: 30,
      allowedReasons: DEFAULT_REASONS,
      returnInstructions:
        "Please ship the item(s) back to us using the provided return label. Make sure items are in their original packaging.",
      autoApprove: false,
    },
    update: {},
  });

  return settings;
}

export async function updateSettings(
  shop: string,
  data: {
    returnWindowDays?: number;
    allowedReasons?: string[];
    returnInstructions?: string;
    autoApprove?: boolean;
    autoApproveReplacements?: boolean;
    enableReplacement?: boolean;
    logoUrl?: string | null;
    portalLogoPosition?: string;
    portalButtonColor?: string | null;
    portalButtonTextColor?: string | null;
    portalTextColor?: string | null;
    portalHeadingFont?: string;
    portalBodyFont?: string;
    marketReturnWindows?: Array<{ marketId: string; marketName: string; returnWindowDays: number }> | null;
    enableRxGrouping?: boolean;
    excludeReplacementForRxGroup?: boolean;
    enableSerialNumbers?: boolean;
    webhookUrl?: string | null;
    webhookSecret?: string | null;
    webhookActive?: boolean;
    webhookEvents?: string[];
    webhookStatusFilters?: string[];
  },
) {
  // Bug #386: Validate returnWindowDays is within valid range
  if (data.returnWindowDays !== undefined) {
    if (typeof data.returnWindowDays !== "number" || data.returnWindowDays < 1 || data.returnWindowDays > 365) {
      throw new Error("returnWindowDays must be between 1 and 365 days");
    }
  }

  // Validate marketReturnWindows structure
  if (data.marketReturnWindows !== undefined && data.marketReturnWindows !== null) {
    if (!Array.isArray(data.marketReturnWindows)) {
      throw new Error("marketReturnWindows must be an array");
    }
    for (const window of data.marketReturnWindows) {
      if (!window || typeof window !== "object") {
        throw new Error("Each marketReturnWindow must be an object");
      }
      if (typeof window.marketId !== "string" || !window.marketId) {
        throw new Error("Each marketReturnWindow must have a valid marketId (string)");
      }
      // Bug #386: Validate market-specific window is within valid range
      if (typeof window.returnWindowDays !== "number" || window.returnWindowDays < 1 || window.returnWindowDays > 365) {
        throw new Error("Each marketReturnWindow must have returnWindowDays between 1 and 365");
      }
    }
  }

  const updateData: Prisma.ReturnSettingsUpdateInput = {
    ...data,
    marketReturnWindows: data.marketReturnWindows as Prisma.InputJsonValue | undefined,
    webhookEvents: data.webhookEvents as Prisma.InputJsonValue | undefined,
    webhookStatusFilters: data.webhookStatusFilters as Prisma.InputJsonValue | undefined,
  };

  return prisma.returnSettings.upsert({
    where: { shop },
    update: updateData,
    create: {
      shop,
      returnWindowDays: data.returnWindowDays ?? 30,
      allowedReasons: data.allowedReasons ?? DEFAULT_REASONS,
      returnInstructions: data.returnInstructions,
      autoApprove: data.autoApprove ?? false,
      autoApproveReplacements: data.autoApproveReplacements ?? false,
      enableReplacement: data.enableReplacement ?? false,
      marketReturnWindows: data.marketReturnWindows as Prisma.InputJsonValue | undefined,
    },
  });
}
