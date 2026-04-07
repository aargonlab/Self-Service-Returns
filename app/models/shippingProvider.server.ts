import prisma from "~/db.server";
import { encryptCredential, decryptCredential } from "~/utils/encryption.server";

export async function getShippingProvider(shop: string, decrypt = false) {
  const provider = await prisma.shippingProvider.findUnique({
    where: { shop },
  });
  if (provider?.apiKey) {
    if (decrypt) {
      try {
        provider.apiKey = decryptCredential(provider.apiKey);
      } catch (error) {
        console.error(`[ShippingProvider] Failed to decrypt API key for shop ${shop}:`, error);
        provider.apiKey = "";
      }
    } else {
      provider.apiKey = "••••••••";
    }
  }
  return provider;
}

export async function upsertShippingProvider(shop: string, data: {
  apiKey: string;
  environment?: string;
  shipEndpoint?: string;
  trackEndpoint?: string;
  active?: boolean;
}) {
  const encryptedApiKey = encryptCredential(data.apiKey);
  const updateData = { ...data, apiKey: encryptedApiKey };

  return prisma.shippingProvider.upsert({
    where: { shop },
    update: updateData,
    create: {
      shop,
      apiKey: encryptedApiKey,
      environment: data.environment,
      shipEndpoint: data.shipEndpoint,
      trackEndpoint: data.trackEndpoint,
      active: data.active,
    },
  });
}

export async function deleteShippingProvider(shop: string) {
  const provider = await prisma.shippingProvider.findUnique({
    where: { shop },
  });
  if (!provider) {
    throw new Error("Shipping provider not found");
  }

  // Clear stale carrier references on routing rules before deleting.
  // Prisma cascade sets carrierAccountId to null, but the legacy 'carrier'
  // text field would keep old values — clear it explicitly.
  await prisma.returnRoutingRule.updateMany({
    where: { shop },
    data: { carrier: null },
  });

  return prisma.shippingProvider.delete({
    where: { shop },
  });
}
