import { randomInt } from "node:crypto";
import prisma from "~/db.server";
import { resolveRoutingRule } from "~/models/returnRoutingRule.server";
import { getDefaultWarehouse } from "~/models/returnWarehouse.server";
import { getShippingProvider } from "~/models/shippingProvider.server";
import { generateLabel as pwGenerateLabel } from "~/services/processWeaver.server";
import type { LabelAddress as PWLabelAddress } from "~/services/processWeaver.server";

// Address type for label generation
interface LabelAddress {
  name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  zip: string;
  country: string;
  phone?: string;
}

/**
 * Validate address structure before storage
 * Ensures minimum required fields are present and non-empty
 */
function validateAddress(addr: Record<string, unknown>): boolean {
  return typeof addr.name === 'string' && addr.name.trim().length > 0
    && typeof addr.address1 === 'string' && addr.address1.trim().length > 0
    && typeof addr.city === 'string' && addr.city.trim().length > 0
    && typeof addr.country === 'string' && addr.country.trim().length > 0;
}

// Generic fallback — only used when no warehouse/routing rules are configured
// In production, merchants MUST configure a warehouse via Settings > Shipping & Routing
const FALLBACK_WAREHOUSE: LabelAddress = {
  name: "Returns Department",
  address1: "Please configure warehouse in settings",
  city: "N/A",
  zip: "00000",
  country: "N/A",
};

// Fake carrier options for realism
const CARRIERS = [
  { name: "DHL Express", prefix: "JD", trackingBase: "https://www.dhl.com/track?tracking=" },
  { name: "UPS", prefix: "1Z", trackingBase: "https://www.ups.com/track?tracknum=" },
  { name: "FedEx", prefix: "7489", trackingBase: "https://www.fedex.com/fedextrack/?trknbr=" },
];

function generateTrackingNumber(prefix: string): string {
  // TODO: Replace with real carrier API integration for production
  // Ensure mock tracking numbers are clearly identifiable as test data
  const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  const length = prefix === "1Z" ? 16 : 12; // UPS is longer
  const chars = uuid.substring(0, length - prefix.length);
  return `TEST-${prefix}${chars}`;
}

function generateBarcode(): string {
  // TODO: Replace with real carrier API integration for production
  // Generate a realistic barcode number (test/placeholder only, EAN-13 style)
  // Use crypto.randomInt for cryptographically secure random numbers
  return Array.from({ length: 12 }, () => randomInt(0, 10)).join("");
}

/**
 * Generate a return shipping label for a return request.
 * In production, this would call a real courier API (DHL, UPS, etc.).
 * For now, it generates realistic-looking label data.
 */
export async function generateShippingLabel(params: {
  returnRequestId: string;
  customerAddress: LabelAddress;
  orderName: string;
  itemCount: number;
  shop?: string;
  marketId?: string | null;
}): Promise<{
  id: string;
  trackingNumber: string;
  trackingUrl: string;
  carrier: string;
  labelUrl: string;
  barcode: string;
}> {
  // Bug #393 Fix: Add try-catch for proper error handling
  try {
    // M-INF3: Trim all string fields in address before validation
    const trimmedAddress = Object.fromEntries(
      Object.entries(params.customerAddress).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    );
    params.customerAddress = trimmedAddress as typeof params.customerAddress;

    // Validate customer address before processing
    if (!validateAddress(params.customerAddress as any)) {
      throw new Error("Invalid customer address: missing required fields (name, address1, city, country)");
    }

    // Resolve warehouse from routing rules, then default warehouse, then fallback
    let warehouseAddress: LabelAddress = FALLBACK_WAREHOUSE;
    let preferredCarrierName: string | null = null;

    if (params.shop) {
      // Try routing rule first (market-specific → default)
      const routingRule = await resolveRoutingRule(params.shop, params.marketId || null);
      if (routingRule?.warehouse) {
        warehouseAddress = {
          name: routingRule.warehouse.name,
          address1: routingRule.warehouse.address1,
          address2: routingRule.warehouse.address2 || undefined,
          city: routingRule.warehouse.city,
          province: routingRule.warehouse.province || undefined,
          zip: routingRule.warehouse.zip,
          country: routingRule.warehouse.country,
          phone: routingRule.warehouse.phone || undefined,
        };
        preferredCarrierName = routingRule.carrierAccount?.carrierCode || null;
      } else {
        // Fall back to default warehouse
        const defaultWh = await getDefaultWarehouse(params.shop);
        if (defaultWh) {
          warehouseAddress = {
            name: defaultWh.name,
            address1: defaultWh.address1,
            address2: defaultWh.address2 || undefined,
            city: defaultWh.city,
            province: defaultWh.province || undefined,
            zip: defaultWh.zip,
            country: defaultWh.country,
            phone: defaultWh.phone || undefined,
          };
        } else {
          console.warn("[ShippingLabel] WARNING: No warehouse configured. Using fallback address. Please configure a warehouse in settings.");
        }
      }

      // Always use ProcessWeaver when a provider is configured and active
      const provider = await getShippingProvider(params.shop, true);
      if (provider?.active) {
        // Find carrier account: prefer the one linked to the routing rule, otherwise pick the first active one
        let carrierAccount = routingRule?.carrierAccount;
        if (!carrierAccount || !carrierAccount.active) {
          const { listCarrierAccounts } = await import("~/models/carrierAccount.server");
          const accounts = await listCarrierAccounts(params.shop);
          carrierAccount = accounts.find((a: any) => a.active) || null;
        }

        if (!carrierAccount) {
          throw new Error("No active carrier account found. Please add a carrier account in Settings > Shipping & Routing.");
        }

        // Decrypt carrier account password for API call
        let decryptedPassword = carrierAccount.password || "";
        if (carrierAccount.password && carrierAccount.password !== "••••••••") {
          const { decryptCredential } = await import("~/utils/encryption.server");
          try {
            decryptedPassword = decryptCredential(carrierAccount.password);
          } catch (error) {
            console.error(`[ShippingLabel] Failed to decrypt carrier password:`, error);
            decryptedPassword = "";
          }
        } else if (carrierAccount.password === "••••••••") {
          // Re-fetch with decrypt=true if we got a masked password
          const { getCarrierAccount } = await import("~/models/carrierAccount.server");
          const decryptedAccount = await getCarrierAccount(carrierAccount.id, params.shop, true);
          decryptedPassword = decryptedAccount?.password || "";
        }

        // Validate warehouse address before passing to ProcessWeaver
        if (!validateAddress(warehouseAddress as any)) {
          throw new Error("Invalid warehouse address: missing required fields (name, address1, city, country). Please configure a valid warehouse in Settings.");
        }

        // Call ProcessWeaver — fail loudly, no silent fallback to mock
        const result = await pwGenerateLabel({
          shipEndpoint: provider.shipEndpoint,
          apiKey: provider.apiKey,
          environment: provider.environment as "TEST" | "PROD",
          labelFormat: (carrierAccount.labelFormat || "PNG") as "PNG" | "PDF" | "ZPL",
          carrierAccount: {
            accountNumber: carrierAccount.accountNumber,
            carrier: carrierAccount.carrierCode,
            serviceType: carrierAccount.serviceType || "",
            password: decryptedPassword,
            userId: carrierAccount.userId || "",
            meterNumber: carrierAccount.meterNumber || "",
            shipDateFormat: carrierAccount.shipDateFormat,
          },
          shipFrom: params.customerAddress as PWLabelAddress,
          shipTo: warehouseAddress as PWLabelAddress,
          returnRequestId: params.returnRequestId,
          weight: params.itemCount ? String(Math.max(0.5, params.itemCount * 0.3 + 0.2).toFixed(1)) : "0.5",
        });

        // Store real label in database
        const label = await prisma.$transaction(async (tx) => {
          const existing = await tx.returnShippingLabel.findUnique({
            where: { returnRequestId: params.returnRequestId },
          });
          if (existing) return existing;

          return tx.returnShippingLabel.create({
            data: {
              returnRequestId: params.returnRequestId,
              carrier: carrierAccount!.name,
              carrierCode: carrierAccount!.carrierCode,
              trackingNumber: result.trackingNumber,
              trackingUrl: result.labelImageUrl || "",
              labelUrl: result.labelImageBase64
                ? `data:image/png;base64,${result.labelImageBase64}`
                : result.labelImageUrl || "",
              labelData: result.labelImageBase64 || null,
              barcode: result.trackingNumber,
              status: "CREATED",
              source: "PROCESSWEAVER",
              sinNumber: result.sin,
              freight: result.freight,
              warehouseAddress: warehouseAddress as any,
              customerAddress: params.customerAddress as any,
              weight: `${Math.max(0.5, params.itemCount * 0.3 + 0.2).toFixed(1)} kg`,
            },
          });
        });

        return {
          id: label.id,
          trackingNumber: label.trackingNumber,
          trackingUrl: label.trackingUrl || "",
          carrier: label.carrier,
          labelUrl: label.labelUrl,
          barcode: label.barcode,
        };
      }
    }

    // Mock label — ONLY when no ProcessWeaver provider is configured
    console.warn("[ShippingLabel] No ProcessWeaver provider configured — generating mock label.");

    // Pick a carrier — prefer routing rule carrier, fall back to default
    const resolvedCarrier = preferredCarrierName
      ? CARRIERS.find((c) => c.name.toLowerCase() === preferredCarrierName!.toLowerCase()) || CARRIERS[0]
      : CARRIERS[0];
    const trackingNumber = generateTrackingNumber(resolvedCarrier.prefix);
    const trackingUrl = `${resolvedCarrier.trackingBase}${trackingNumber}`;
    const barcode = generateBarcode();

    // Estimate delivery based on country match
    const isInternational = params.customerAddress.country !== warehouseAddress.country;
    const estimatedDelivery = isInternational ? "5-7 business days" : "2-3 business days";

    // Estimate weight based on item count
    const weight = `${Math.max(0.5, params.itemCount * 0.3 + 0.2).toFixed(1)} kg`;

    // Generate a label URL — this is a data URI SVG that looks like a real shipping label
    const labelUrl = generateLabelSvgDataUri({
      carrier: resolvedCarrier.name,
      trackingNumber,
      barcode,
      from: warehouseAddress,
      to: params.customerAddress,
      orderRef: params.orderName,
      weight,
      date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    });

    // Use transaction with check-then-create pattern to prevent race condition
    const label = await prisma.$transaction(async (tx) => {
      // Check if label already exists within transaction
      const existing = await tx.returnShippingLabel.findUnique({
        where: { returnRequestId: params.returnRequestId },
      });
      if (existing) {
        return existing;
      }

      // Create new label
      return tx.returnShippingLabel.create({
        data: {
          returnRequestId: params.returnRequestId,
          carrier: resolvedCarrier.name,
          trackingNumber,
          trackingUrl,
          labelUrl,
          barcode,
          status: "CREATED",
          warehouseAddress: warehouseAddress as any,
          customerAddress: params.customerAddress as any,
          weight,
          estimatedDelivery,
        },
      });
    });

    return {
      id: label.id,
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl || "",
      carrier: label.carrier,
      labelUrl: label.labelUrl,
      barcode: label.barcode,
    };
  } catch (error) {
    console.error("[ShippingLabel] Failed to generate shipping label:", error);
    throw new Error("Failed to generate shipping label. Please try again later.");
  }
}

/**
 * Get an existing shipping label for a return request.
 */
export async function getShippingLabel(returnRequestId: string, shop: string) {
  return prisma.returnShippingLabel.findFirst({
    where: {
      returnRequestId,
      returnRequest: { shop }
    },
  });
}

/**
 * Upload a manual shipping label (PDF/image) with tracking info.
 * Used when ProcessWeaver is unavailable and the merchant has a label file.
 */
export async function uploadManualLabel(params: {
  returnRequestId: string;
  shop: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  labelFileBase64: string;
  labelContentType: string;
  labelFileName: string;
}): Promise<{
  id: string;
  trackingNumber: string;
  trackingUrl: string;
  carrier: string;
  labelUrl: string;
}> {
  // Validate required fields
  if (!params.carrier?.trim()) throw new Error("Carrier name is required");
  if (!params.trackingNumber?.trim()) throw new Error("Tracking number is required");
  if (!params.labelFileBase64) throw new Error("Label file is required");

  // Validate file type
  const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
  if (!allowedTypes.includes(params.labelContentType)) {
    throw new Error("Invalid file type. Allowed: PDF, PNG, JPG");
  }

  // Validate file size (10MB max)
  const fileSizeBytes = Buffer.from(params.labelFileBase64, "base64").length;
  if (fileSizeBytes > 10 * 1024 * 1024) {
    throw new Error("File too large. Maximum size is 10MB");
  }

  // Verify ownership
  const returnRequest = await prisma.returnRequest.findFirst({
    where: { id: params.returnRequestId, shop: params.shop },
  });
  if (!returnRequest) throw new Error("Return request not found");

  // Build label URL as data URI
  const labelUrl = `data:${params.labelContentType};base64,${params.labelFileBase64}`;

  // Upsert — replace existing label or create new
  const label = await prisma.returnShippingLabel.upsert({
    where: { returnRequestId: params.returnRequestId },
    update: {
      carrier: params.carrier.trim(),
      trackingNumber: params.trackingNumber.trim(),
      trackingUrl: params.trackingUrl?.trim() || null,
      labelUrl,
      labelData: params.labelFileBase64,
      source: "MANUAL",
      status: "CREATED",
    },
    create: {
      returnRequestId: params.returnRequestId,
      carrier: params.carrier.trim(),
      trackingNumber: params.trackingNumber.trim(),
      trackingUrl: params.trackingUrl?.trim() || null,
      labelUrl,
      labelData: params.labelFileBase64,
      barcode: params.trackingNumber.trim(),
      source: "MANUAL",
      status: "CREATED",
      warehouseAddress: {},
      customerAddress: {},
    },
  });

  // Add timeline event
  const { addTimelineEvent } = await import("~/models/returnTimeline.server");
  await addTimelineEvent({
    returnRequestId: params.returnRequestId,
    event: `Shipping label uploaded manually (${params.carrier.trim()}, ${params.trackingNumber.trim()})`,
    actor: "Admin",
    actorType: "AGENT",
    shop: params.shop,
  });

  // Auto-transition to AWAITING_SHIPMENT if the return is currently APPROVED
  if (returnRequest.status === "APPROVED") {
    const { transitionStatus } = await import("~/services/stateMachine.server");
    try {
      await transitionStatus(params.returnRequestId, "AWAITING_SHIPMENT", {
        name: "System",
        type: "SYSTEM",
      }, undefined, params.shop);
    } catch (err) {
      console.error("Failed to transition to AWAITING_SHIPMENT after label upload:", err);
    }
  }

  return {
    id: label.id,
    trackingNumber: label.trackingNumber,
    trackingUrl: label.trackingUrl || "",
    carrier: label.carrier,
    labelUrl: label.labelUrl,
  };
}

/**
 * Update tracking info on an existing manual label.
 * Allows updating carrier, tracking number, tracking URL without re-uploading the file.
 */
export async function updateManualLabel(params: {
  returnRequestId: string;
  shop: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
}): Promise<{ success: boolean }> {
  const label = await prisma.returnShippingLabel.findFirst({
    where: {
      returnRequestId: params.returnRequestId,
      returnRequest: { shop: params.shop },
    },
  });
  if (!label) throw new Error("No shipping label found for this return");

  const updateData: Record<string, string | null> = {};
  if (params.carrier?.trim()) updateData.carrier = params.carrier.trim();
  if (params.trackingNumber?.trim()) updateData.trackingNumber = params.trackingNumber.trim();
  if (params.trackingUrl !== undefined) updateData.trackingUrl = params.trackingUrl?.trim() || null;

  if (Object.keys(updateData).length === 0) {
    return { success: true }; // Nothing to update
  }

  await prisma.returnShippingLabel.update({
    where: { id: label.id },
    data: updateData,
  });

  // Add timeline event
  const { addTimelineEvent } = await import("~/models/returnTimeline.server");
  const changes = Object.keys(updateData).join(", ");
  await addTimelineEvent({
    returnRequestId: params.returnRequestId,
    event: `Shipping label tracking info updated (${changes})`,
    actor: "Admin",
    actorType: "AGENT",
    shop: params.shop,
  });

  return { success: true };
}

/**
 * Track a shipment using ProcessWeaver Track API.
 * Updates the shipping label record with the latest tracking events.
 */
export async function trackShipment(returnRequestId: string, shop: string) {
  const label = await prisma.returnShippingLabel.findFirst({
    where: { returnRequestId, returnRequest: { shop } },
  });
  if (!label || label.source !== "PROCESSWEAVER") {
    return null; // Can't track mock labels
  }

  // Get the carrier account from the routing rule
  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
  });
  if (!returnRequest) return null;

  const provider = await getShippingProvider(shop, true);
  if (!provider) return null;

  // Find carrier account by carrier code - decrypt password for API call
  const carrierAccount = await prisma.carrierAccount.findFirst({
    where: { shop, carrierCode: label.carrierCode || "", active: true },
  });
  if (!carrierAccount) return null;

  // Decrypt password for tracking API call
  if (carrierAccount.password) {
    const { decryptCredential } = await import("~/utils/encryption.server");
    try {
      carrierAccount.password = decryptCredential(carrierAccount.password);
    } catch (error) {
      console.error(`[ShippingLabel] Failed to decrypt password for tracking:`, error);
      return null;
    }
  }

  // Import trackPackage and isDelivered
  const { trackPackage, isDelivered } = await import("~/services/processWeaver.server");

  try {
    const trackResult = await trackPackage({
      trackEndpoint: provider.trackEndpoint,
      apiKey: provider.apiKey,
      carrierAccount: {
        accountNumber: carrierAccount.accountNumber,
        carrier: carrierAccount.carrierCode,
        serviceType: carrierAccount.serviceType || "",
        password: carrierAccount.password || "",
        userId: carrierAccount.userId || "",
        meterNumber: carrierAccount.meterNumber || "",
      },
      trackingNumber: label.trackingNumber,
      returnRequestId,
    });

    // Update label with tracking data
    const newStatus = isDelivered(trackResult) ? "DELIVERED" : (trackResult.events.length > 0 ? "IN_TRANSIT" : label.status);

    await prisma.returnShippingLabel.update({
      where: { id: label.id },
      data: {
        trackingUrl: trackResult.trackingUrl || label.trackingUrl,
        trackingEvents: trackResult.events as any,
        lastTrackedAt: new Date(),
        status: newStatus,
        podSignedBy: trackResult.podSignedBy || null,
        podDocument: trackResult.podDocument || null,
      },
    });

    return trackResult;
  } catch (error) {
    console.error("[ShippingLabel] Tracking failed:", error);
    return null;
  }
}

/**
 * Generate an SVG data URI that looks like a real shipping label.
 * This creates a printable label with all the shipping info.
 */
function generateLabelSvgDataUri(params: {
  carrier: string;
  trackingNumber: string;
  barcode: string;
  from: LabelAddress;
  to: LabelAddress;
  orderRef: string;
  weight: string;
  date: string;
}): string {
  const { carrier, trackingNumber, barcode, from, to, orderRef, weight, date } = params;

  // Generate simple barcode bars (Code 128 style visual)
  // Use crypto.randomInt for visual barcode generation (not security-critical but consistent)
  let barcodeBars = "";
  for (let i = 0; i < barcode.length * 3; i++) {
    const x = 120 + i * 4;
    const isBar = randomInt(0, 100) > 35;
    if (isBar) {
      const w = randomInt(0, 2) === 0 ? 3 : 2;
      barcodeBars += `<rect x="${x}" y="440" width="${w}" height="60" fill="black"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="580" viewBox="0 0 400 580">
  <rect width="400" height="580" fill="white" stroke="#333" stroke-width="2"/>

  <!-- Header -->
  <rect x="0" y="0" width="400" height="50" fill="#333"/>
  <text x="200" y="33" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="20" font-weight="bold">${carrier}</text>

  <!-- Return Label Badge -->
  <rect x="130" y="58" width="140" height="24" rx="4" fill="#dc3545"/>
  <text x="200" y="75" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="12" font-weight="bold">RETURN SHIPMENT</text>

  <!-- FROM section -->
  <text x="20" y="110" fill="#666" font-family="Arial, sans-serif" font-size="10" font-weight="bold">FROM (Customer):</text>
  <text x="20" y="126" fill="#333" font-family="Arial, sans-serif" font-size="12" font-weight="bold">${escapeXml(to.name)}</text>
  <text x="20" y="142" fill="#333" font-family="Arial, sans-serif" font-size="11">${escapeXml(to.address1)}</text>
  <text x="20" y="157" fill="#333" font-family="Arial, sans-serif" font-size="11">${escapeXml(to.zip)} ${escapeXml(to.city)}${to.province ? `, ${escapeXml(to.province)}` : ""}</text>
  <text x="20" y="172" fill="#333" font-family="Arial, sans-serif" font-size="11">${escapeXml(to.country)}</text>
  ${to.phone ? `<text x="20" y="187" fill="#666" font-family="Arial, sans-serif" font-size="10">Tel: ${escapeXml(to.phone)}</text>` : ""}

  <line x1="20" y1="198" x2="380" y2="198" stroke="#ccc" stroke-width="1"/>

  <!-- TO section -->
  <text x="20" y="218" fill="#666" font-family="Arial, sans-serif" font-size="10" font-weight="bold">TO (Warehouse):</text>
  <text x="20" y="234" fill="#333" font-family="Arial, sans-serif" font-size="14" font-weight="bold">${escapeXml(from.name)}</text>
  ${from.company ? `<text x="20" y="252" fill="#333" font-family="Arial, sans-serif" font-size="12">${escapeXml(from.company)}</text>` : ""}
  <text x="20" y="${from.company ? "268" : "252"}" fill="#333" font-family="Arial, sans-serif" font-size="12">${escapeXml(from.address1)}</text>
  <text x="20" y="${from.company ? "284" : "268"}" fill="#333" font-family="Arial, sans-serif" font-size="12">${escapeXml(from.zip)} ${escapeXml(from.city)}${from.province ? `, ${escapeXml(from.province)}` : ""}</text>
  <text x="20" y="${from.company ? "300" : "284"}" fill="#333" font-family="Arial, sans-serif" font-size="12">${escapeXml(from.country)}</text>
  ${from.phone ? `<text x="20" y="${from.company ? "316" : "300"}" fill="#666" font-family="Arial, sans-serif" font-size="10">Tel: ${escapeXml(from.phone)}</text>` : ""}

  <line x1="20" y1="330" x2="380" y2="330" stroke="#ccc" stroke-width="1"/>

  <!-- Shipment details -->
  <text x="20" y="352" fill="#666" font-family="Arial, sans-serif" font-size="10">ORDER REF:</text>
  <text x="100" y="352" fill="#333" font-family="Arial, sans-serif" font-size="10" font-weight="bold">${escapeXml(orderRef)}</text>
  <text x="220" y="352" fill="#666" font-family="Arial, sans-serif" font-size="10">DATE:</text>
  <text x="260" y="352" fill="#333" font-family="Arial, sans-serif" font-size="10" font-weight="bold">${escapeXml(date)}</text>

  <text x="20" y="372" fill="#666" font-family="Arial, sans-serif" font-size="10">WEIGHT:</text>
  <text x="100" y="372" fill="#333" font-family="Arial, sans-serif" font-size="10" font-weight="bold">${escapeXml(weight)}</text>
  <text x="220" y="372" fill="#666" font-family="Arial, sans-serif" font-size="10">SERVICE:</text>
  <text x="280" y="372" fill="#333" font-family="Arial, sans-serif" font-size="10" font-weight="bold">Standard</text>

  <!-- Tracking -->
  <rect x="20" y="390" width="360" height="30" rx="4" fill="#f8f9fa" stroke="#dee2e6"/>
  <text x="200" y="410" text-anchor="middle" fill="#333" font-family="monospace" font-size="14" font-weight="bold">${escapeXml(trackingNumber)}</text>

  <!-- Barcode -->
  ${barcodeBars}
  <text x="200" y="520" text-anchor="middle" fill="#333" font-family="monospace" font-size="10">${escapeXml(barcode)}</text>

  <!-- Footer -->
  <text x="200" y="555" text-anchor="middle" fill="#999" font-family="Arial, sans-serif" font-size="8">This label was generated by SelfServiceReturn. Please print and attach to your package.</text>
  <text x="200" y="570" text-anchor="middle" fill="#999" font-family="Arial, sans-serif" font-size="8">Drop off at any ${escapeXml(carrier)} service point.</text>
</svg>`;

  // Encode as data URI
  const encoded = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
