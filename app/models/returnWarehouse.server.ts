import prisma from "~/db.server";

export async function listWarehouses(shop: string) {
  return prisma.returnWarehouse.findMany({
    where: { shop },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function getWarehouse(id: string, shop: string) {
  return prisma.returnWarehouse.findFirst({
    where: { id, shop },
  });
}

export async function createWarehouse(shop: string, data: {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  zip: string;
  country: string;
  countryCode?: string;
  phone?: string;
  email?: string;
  isDefault?: boolean;
}) {
  // Validate input lengths
  if (data.name.length > 255) throw new Error("Warehouse name must not exceed 255 characters");
  if (data.address1.length > 500) throw new Error("Address must not exceed 500 characters");
  if (data.city.length > 255) throw new Error("City must not exceed 255 characters");
  if (data.zip.length > 20) throw new Error("ZIP code must not exceed 20 characters");
  if (data.country.length > 100) throw new Error("Country must not exceed 100 characters");

  return prisma.$transaction(async (tx) => {
    // If setting as default, unset current default first
    if (data.isDefault) {
      await tx.returnWarehouse.updateMany({
        where: { shop, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.returnWarehouse.create({
      data: { shop, ...data },
    });
  });
}

export async function updateWarehouse(id: string, shop: string, data: {
  name?: string;
  address1?: string;
  address2?: string | null;
  city?: string;
  province?: string | null;
  zip?: string;
  country?: string;
  countryCode?: string | null;
  phone?: string | null;
  email?: string | null;
  isDefault?: boolean;
  active?: boolean;
}) {
  // Verify ownership
  const warehouse = await prisma.returnWarehouse.findFirst({ where: { id, shop } });
  if (!warehouse) throw new Error("Warehouse not found");

  // Validate input lengths
  if (data.name && data.name.length > 255) throw new Error("Warehouse name must not exceed 255 characters");
  if (data.address1 && data.address1.length > 500) throw new Error("Address must not exceed 500 characters");
  if (data.city && data.city.length > 255) throw new Error("City must not exceed 255 characters");
  if (data.zip && data.zip.length > 20) throw new Error("ZIP code must not exceed 20 characters");
  if (data.country && data.country.length > 100) throw new Error("Country must not exceed 100 characters");

  return prisma.$transaction(async (tx) => {
    // If setting as default, unset current default first
    if (data.isDefault) {
      await tx.returnWarehouse.updateMany({
        where: { shop, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.returnWarehouse.update({
      where: { id },
      data,
    });
  });
}

export async function deleteWarehouse(id: string, shop: string) {
  // Verify ownership before delete
  const warehouse = await prisma.returnWarehouse.findFirst({
    where: { id, shop },
  });
  if (!warehouse) {
    throw new Error("Warehouse not found");
  }
  return prisma.returnWarehouse.delete({
    where: { id },
  });
}

export async function getDefaultWarehouse(shop: string) {
  return prisma.returnWarehouse.findFirst({
    where: { shop, isDefault: true, active: true },
  });
}
