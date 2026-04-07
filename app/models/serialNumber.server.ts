import prisma from "~/db.server";

interface SerialNumberMetafield {
  line_items: Array<{
    line_item_id: number;
    sap_line_id: string;
    serial_number: string;
  }>;
}

interface LineItem {
  id: string; // Shopify line item GID
  productId?: string;
  variantId?: string;
  title: string;
  variantTitle?: string;
  sku?: string;
  image?: {
    url?: string;
  };
}

/**
 * Sync serial numbers from Shopify order metafield to database.
 * This is idempotent and can be called multiple times.
 */
export async function syncSerialNumbersFromMetafield(
  shop: string,
  orderId: string,
  orderName: string,
  metafieldJson: string | object,
  lineItems: LineItem[],
) {
  // Parse and validate metafield structure
  let metafield: SerialNumberMetafield;
  try {
    const parsed = typeof metafieldJson === "string" ? JSON.parse(metafieldJson) : metafieldJson;

    // Validate top-level structure
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Metafield must be a JSON object");
    }
    if (!Array.isArray(parsed.line_items)) {
      throw new Error("Metafield missing 'line_items' array");
    }

    // Validate each entry in line_items
    for (let i = 0; i < parsed.line_items.length; i++) {
      const entry = parsed.line_items[i];
      if (!entry || typeof entry !== "object") {
        throw new Error(`line_items[${i}] must be an object`);
      }
      if (typeof entry.line_item_id !== "number" || !Number.isFinite(entry.line_item_id)) {
        throw new Error(`line_items[${i}].line_item_id must be a finite number`);
      }
      if (typeof entry.sap_line_id !== "string" || !entry.sap_line_id) {
        throw new Error(`line_items[${i}].sap_line_id must be a non-empty string`);
      }
      if (typeof entry.serial_number !== "string" || !entry.serial_number) {
        throw new Error(`line_items[${i}].serial_number must be a non-empty string`);
      }
    }

    metafield = parsed as SerialNumberMetafield;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid serial number metafield JSON: ${error.message}`);
    }
    throw new Error(`Invalid serial number metafield: ${error instanceof Error ? error.message : error}`);
  }

  // Build a map of numeric line item IDs to full line item data
  const lineItemMap = new Map<number, LineItem>();
  for (const item of lineItems) {
    // Extract numeric ID from GID (e.g., "gid://shopify/LineItem/123456789" -> 123456789)
    const match = item.id.match(/\/LineItem\/(\d+)$/);
    if (match) {
      lineItemMap.set(parseInt(match[1], 10), item);
    }
  }

  // Upsert each serial number
  const operations = metafield.line_items.map(async (entry) => {
    const lineItem = lineItemMap.get(entry.line_item_id);
    if (!lineItem) {
      console.warn(
        `Line item ${entry.line_item_id} not found in order ${orderName}, skipping serial number ${entry.serial_number}`,
      );
      return null;
    }

    // Convert numeric line item ID to GID format
    const lineItemId = `gid://shopify/LineItem/${entry.line_item_id}`;

    return prisma.serialNumber.upsert({
      where: {
        shop_orderId_serialNumber: {
          shop,
          orderId,
          serialNumber: entry.serial_number,
        },
      },
      update: {
        // Update cached display fields in case they changed
        orderName,
        lineItemId,
        variantId: lineItem.variantId,
        productTitle: lineItem.title,
        variantTitle: lineItem.variantTitle,
        sku: lineItem.sku,
        imageUrl: lineItem.image?.url,
        sapLineId: entry.sap_line_id,
        updatedAt: new Date(),
      },
      create: {
        shop,
        orderId,
        orderName,
        lineItemId,
        variantId: lineItem.variantId,
        productTitle: lineItem.title,
        variantTitle: lineItem.variantTitle,
        sku: lineItem.sku,
        imageUrl: lineItem.image?.url,
        sapLineId: entry.sap_line_id,
        serialNumber: entry.serial_number,
        status: "ACTIVE",
      },
    });
  });

  const results = await Promise.all(operations);
  return results.filter((r) => r !== null);
}

/**
 * Get all serial numbers for an order, ordered by line item and ERP line ID.
 */
export async function getSerialNumbersForOrder(shop: string, orderId: string) {
  return prisma.serialNumber.findMany({
    where: { shop, orderId },
    orderBy: [{ lineItemId: "asc" }, { sapLineId: "asc" }],
  });
}

/**
 * Get active serial numbers for an order (available for return).
 */
export async function getActiveSerialNumbersForOrder(shop: string, orderId: string) {
  return prisma.serialNumber.findMany({
    where: { shop, orderId, status: "ACTIVE" },
    orderBy: [{ lineItemId: "asc" }, { sapLineId: "asc" }],
  });
}

/**
 * Mark serial numbers as IN_RETURN and link to return items.
 * This is called when a return request is created or updated.
 */
export async function markSerialNumbersInReturn(
  shop: string,
  orderId: string,
  serialNumbers: Array<{ serialNumber: string; returnItemId: string }>,
) {
  const results = await prisma.$transaction(
    serialNumbers.map((entry) =>
      prisma.serialNumber.updateMany({
        where: {
          shop,
          orderId,
          serialNumber: entry.serialNumber,
          status: "ACTIVE",
        },
        data: {
          status: "IN_RETURN",
          returnItemId: entry.returnItemId,
          updatedAt: new Date(),
        },
      }),
    ),
  );

  // Verify all serial numbers were marked — detect partial failures
  const failedIndices: string[] = [];
  results.forEach((result, index) => {
    if (result.count === 0) {
      failedIndices.push(serialNumbers[index].serialNumber);
    }
  });

  if (failedIndices.length > 0) {
    throw new Error(
      `Failed to mark serial numbers as IN_RETURN: ${failedIndices.join(", ")}. ` +
      `They may not exist, not be ACTIVE, or already be in another return.`
    );
  }

  return results;
}

/**
 * Mark serial numbers as RETURNED when return is completed/accepted.
 * This is called when the return reaches a final state.
 */
export async function markSerialNumbersReturned(
  shop: string,
  orderId: string,
  returnItemIds: string[],
) {
  return prisma.serialNumber.updateMany({
    where: {
      shop,
      orderId,
      returnItemId: { in: returnItemIds },
      status: "IN_RETURN",
    },
    data: {
      status: "RETURNED",
      updatedAt: new Date(),
    },
  });
}

/**
 * Release serial numbers back to ACTIVE status when a return is cancelled.
 * Clears the returnItemId link.
 */
export async function releaseSerialNumbers(
  shop: string,
  orderId: string,
  returnItemIds: string[],
) {
  const result = await prisma.serialNumber.updateMany({
    where: {
      shop,
      orderId,
      returnItemId: { in: returnItemIds },
      status: "IN_RETURN", // Only release serial numbers that are actually IN_RETURN
    },
    data: {
      status: "ACTIVE",
      returnItemId: null,
      updatedAt: new Date(),
    },
  });

  if (result.count === 0 && returnItemIds.length > 0) {
    console.warn(`[SerialNumbers] No serial numbers released for returnItemIds: ${returnItemIds.join(", ")}. They may not be in IN_RETURN status.`);
  }

  return result;
}
