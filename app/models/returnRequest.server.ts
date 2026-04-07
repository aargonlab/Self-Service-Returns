import prisma from "~/db.server";
import type { ReturnStatus, ResolutionType, Prisma } from "@prisma/client";

export interface ReturnRequestFilters {
  shop: string;
  status?: ReturnStatus | ReturnStatus[];
  resolutionType?: ResolutionType;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

export async function createReturnRequest(
  data: Prisma.ReturnRequestCreateInput & {
    items: Prisma.ReturnItemCreateWithoutReturnRequestInput[];
    requireManualApproval?: boolean;
    marketId?: string | null;
    requiresShoppingEligibility?: boolean;
  },
) {
  const { items, requireManualApproval, marketId, requiresShoppingEligibility, ...requestData } = data;

  // Bug #1 Fix: Validate that items array is non-empty
  if (!items || items.length === 0) {
    throw new Error("At least one return item is required");
  }

  // Bug #391 Fix: Validate input length to prevent extremely long strings
  if (requestData.customerName && requestData.customerName.length > 255) {
    throw new Error("Customer name must not exceed 255 characters");
  }
  if (requestData.customerEmail && requestData.customerEmail.length > 255) {
    throw new Error("Customer email must not exceed 255 characters");
  }
  if (typeof (requestData as Record<string, unknown>).notes === "string" && ((requestData as Record<string, unknown>).notes as string).length > 5000) {
    throw new Error("Notes must not exceed 5000 characters");
  }

  // Note: This is atomic - Prisma's nested create wraps everything in a transaction
  return prisma.returnRequest.create({
    data: {
      ...requestData,
      requireManualApproval,
      requiresShoppingEligibility,
      marketId,
      items: {
        create: items,
      },
    },
    include: {
      items: {
        include: {
          attachments: true,
        },
      },
    },
  });
}

export async function getReturnRequest(id: string, shop: string) {
  return prisma.returnRequest.findFirst({
    where: { id, shop },
    include: {
      items: {
        include: {
          attachments: true,
        },
      },
      comments: {
        orderBy: { createdAt: "asc" },
      },
      timeline: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function getReturnRequestByShopifyId(shopifyReturnId: string, shop: string) {
  return prisma.returnRequest.findFirst({
    where: { shopifyReturnId, shop },
    include: {
      items: {
        include: {
          attachments: true,
        },
      },
      comments: {
        orderBy: { createdAt: "asc" },
      },
      timeline: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

/**
 * Get return request by ID and email for portal authentication.
 *
 * Note: Shop scope is intentionally omitted for portal use case.
 * The combination of returnRequestId (cuid - unguessable) + email provides
 * sufficient security for customer portal access. The cuid is cryptographically
 * random and not derivable from order information alone.
 */
export async function getReturnRequestByIdAndEmail(id: string, email: string, shop?: string) {
  const where: Prisma.ReturnRequestWhereInput = {
    id,
    customerEmail: { equals: email, mode: "insensitive" },
    ...(shop ? { shop } : {}),
  };
  return prisma.returnRequest.findFirst({
    where,
    include: {
      items: {
        include: {
          attachments: true,
        },
      },
      comments: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
      },
      timeline: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function listReturnRequests(filters: ReturnRequestFilters) {
  const {
    shop,
    status,
    resolutionType,
    search,
    dateFrom,
    dateTo,
    page = 1,
    pageSize = 20,
  } = filters;

  // Bug #2 Fix: Cap page number to prevent huge skip values and DB timeout
  // OFFSET-based pagination degrades at high page numbers. Cap at 1000 pages.
  // For large datasets, consider implementing cursor-based pagination in the future.
  const requestedPage = Math.max(page || 1, 1);
  const safePage = Math.min(requestedPage, 1000);

  // M-DI4: Warn when pagination limit is reached
  if (requestedPage > 1000) {
    console.warn(`[ReturnRequest] Pagination limit reached (requested page ${requestedPage}, capped at 1000). Consider using cursor-based pagination or date filters for large datasets.`);
  }

  // Guard against division by zero and cap at 100
  const safePageSize = Math.min(Math.max(pageSize || 20, 1), 100);

  const where: Prisma.ReturnRequestWhereInput = {
    shop,
  };

  if (status) {
    where.status = Array.isArray(status) ? { in: status } : status;
  }

  if (resolutionType) {
    where.resolutionType = resolutionType;
  }

  if (search) {
    const safeSearch = search.slice(0, 200);
    where.OR = [
      { shopifyOrderName: { contains: safeSearch, mode: "insensitive" } },
      { customerName: { contains: safeSearch, mode: "insensitive" } },
      { customerEmail: { contains: safeSearch, mode: "insensitive" } },
    ];
  }

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = dateFrom;
    if (dateTo) where.createdAt.lte = dateTo;
  }

  const [items, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include: {
        items: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.returnRequest.count({ where }),
  ]);

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.ceil(total / safePageSize),
  };
}

export async function getReturnRequestCountsByStatus(shop: string) {
  const counts = await prisma.returnRequest.groupBy({
    by: ["status"],
    where: { shop },
    _count: { status: true },
  });

  const result: Record<string, number> = {};
  for (const item of counts) {
    result[item.status] = item._count.status;
  }
  return result;
}

export async function findReturnRequestsByOrder(
  shop: string,
  shopifyOrderId: string,
) {
  return prisma.returnRequest.findMany({
    where: {
      shop,
      shopifyOrderId,
      status: { notIn: ["CANCELLED", "REJECTED"] },
    },
    include: {
      items: true,
    },
  });
}

export async function findReturnRequestsByOrderAndEmail(
  shop: string,
  shopifyOrderId: string,
  email: string,
) {
  return prisma.returnRequest.findMany({
    where: {
      shop,
      shopifyOrderId,
      customerEmail: { equals: email, mode: "insensitive" },
    },
    include: {
      items: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateReturnRequestShopifyId(
  id: string,
  shop: string,
  shopifyReturnId: string,
) {
  return prisma.returnRequest.updateMany({
    where: { id, shop },
    data: { shopifyReturnId },
  });
}

/**
 * Resolve a return ID parameter to the internal CUID.
 * Accepts: internal CUID, Shopify GID, or numeric Shopify return ID.
 * Returns null if the return doesn't exist or doesn't belong to the shop.
 */
export async function resolveReturnId(idParam: string, shop: string): Promise<string | null> {
  let where: any;

  if (idParam.startsWith("gid://shopify/Return/")) {
    where = { shopifyReturnId: idParam, shop };
  } else if (/^\d+$/.test(idParam)) {
    where = { shopifyReturnId: `gid://shopify/Return/${idParam}`, shop };
  } else if (/^c[a-z0-9]{20,}$/i.test(idParam)) {
    where = { id: idParam, shop };
  } else {
    return null;
  }

  const record = await prisma.returnRequest.findFirst({
    where,
    select: { id: true },
  });

  return record?.id ?? null;
}

/**
 * Validate state consistency of a return request.
 * Returns an array of inconsistency descriptions (empty = consistent).
 */
export function validateReturnConsistency(
  returnRequest: { status: string; closedAt: Date | null; resolutionType: string | null },
): string[] {
  const issues: string[] = [];

  const terminalStatuses = ["CLOSED", "CANCELLED"];
  const isTerminal = terminalStatuses.includes(returnRequest.status);

  if (isTerminal && !returnRequest.closedAt) {
    issues.push(`Status is ${returnRequest.status} but closedAt is null`);
  }
  if (!isTerminal && returnRequest.closedAt) {
    issues.push(`Status is ${returnRequest.status} but closedAt is set`);
  }

  return issues;
}
