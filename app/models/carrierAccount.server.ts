import prisma from "~/db.server";
import { encryptCredential, decryptCredential } from "~/utils/encryption.server";

export async function listCarrierAccounts(shop: string) {
  const accounts = await prisma.carrierAccount.findMany({
    where: { shop },
    include: { provider: true },
    orderBy: { carrierCode: "asc" },
  });
  return accounts.map(account => ({
    ...account,
    // Mask credentials — only show whether they're set, not the actual values
    password: account.password ? "••••••••" : null,
  }));
}

export async function getCarrierAccount(id: string, shop: string, decrypt = false) {
  const account = await prisma.carrierAccount.findFirst({
    where: { id, shop },
    include: { provider: true },
  });
  if (account?.password) {
    if (decrypt) {
      try {
        account.password = decryptCredential(account.password);
      } catch (error) {
        console.error(`[CarrierAccount] Failed to decrypt password for account ${account.id}:`, error);
        account.password = null;
      }
    } else {
      account.password = "••••••••";
    }
  }
  return account;
}

export async function createCarrierAccount(shop: string, data: {
  providerId: string;
  name: string;
  carrierCode: string;
  accountNumber: string;
  userId?: string | null;
  password?: string | null;
  meterNumber?: string | null;
  serviceType?: string | null;
  paymentType?: string;
  shipDateFormat?: string;
  labelFormat?: string;
}) {
  const provider = await prisma.shippingProvider.findFirst({
    where: { id: data.providerId, shop },
  });
  if (!provider) throw new Error("Shipping provider not found");

  return prisma.carrierAccount.create({
    data: {
      shop,
      providerId: data.providerId,
      name: data.name,
      carrierCode: data.carrierCode,
      accountNumber: data.accountNumber,
      userId: data.userId || null,
      password: data.password ? encryptCredential(data.password) : null,
      meterNumber: data.meterNumber || null,
      serviceType: data.serviceType || null,
      paymentType: data.paymentType || "SENDER",
      shipDateFormat: data.shipDateFormat || "yyyy-MM-dd",
      labelFormat: data.labelFormat || "PNG",
    },
    include: { provider: true },
  });
}

export async function updateCarrierAccount(id: string, shop: string, data: {
  name?: string;
  carrierCode?: string;
  accountNumber?: string;
  userId?: string | null;
  password?: string | null;
  meterNumber?: string | null;
  serviceType?: string | null;
  paymentType?: string;
  shipDateFormat?: string;
  labelFormat?: string;
  active?: boolean;
}) {
  const account = await prisma.carrierAccount.findFirst({
    where: { id, shop },
  });
  if (!account) throw new Error("Carrier account not found");

  const updateData = { ...data };
  if (updateData.password !== undefined && updateData.password !== null) {
    updateData.password = encryptCredential(updateData.password);
  }

  return prisma.carrierAccount.update({
    where: { id },
    data: updateData,
    include: { provider: true },
  });
}

export async function deleteCarrierAccount(id: string, shop: string) {
  const account = await prisma.carrierAccount.findFirst({
    where: { id, shop },
  });
  if (!account) {
    throw new Error("Carrier account not found");
  }
  return prisma.carrierAccount.delete({
    where: { id },
  });
}
