import prisma from "~/db.server";

export async function getActiveTranslations(shop: string) {
  return prisma.portalTranslation.findMany({
    where: { shop, active: true },
    orderBy: { locale: "asc" },
  });
}

export async function getTranslation(shop: string, locale: string) {
  return prisma.portalTranslation.findUnique({
    where: { shop_locale: { shop, locale } },
  });
}

export async function getDefaultTranslation(shop: string) {
  return prisma.portalTranslation.findFirst({
    where: { shop, isDefault: true, active: true },
  });
}

export async function upsertTranslation(
  shop: string,
  locale: string,
  messages: Record<string, string>,
  isDefault?: boolean,
) {
  // Wrap in transaction to prevent race condition
  return prisma.$transaction(async (tx) => {
    // If setting as default, unset other defaults first within transaction
    if (isDefault) {
      await tx.portalTranslation.updateMany({
        where: { shop, isDefault: true },
        data: { isDefault: false },
      });
    }

    // Check if this is the first translation (for auto-default behavior)
    const existingCount = await tx.portalTranslation.count({
      where: { shop },
    });
    const shouldBeDefault = isDefault ?? (existingCount === 0);

    return tx.portalTranslation.upsert({
      where: { shop_locale: { shop, locale } },
      create: {
        shop,
        locale,
        messages,
        isDefault: shouldBeDefault,
        active: true,
      },
      update: {
        messages,
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
    });
  });
}

export async function setDefaultLocale(shop: string, locale: string) {
  // Wrap both operations in transaction to prevent race condition
  return prisma.$transaction(async (tx) => {
    await tx.portalTranslation.updateMany({
      where: { shop, isDefault: true },
      data: { isDefault: false },
    });
    await tx.portalTranslation.update({
      where: { shop_locale: { shop, locale } },
      data: { isDefault: true },
    });
  });
}

export async function toggleTranslationActive(shop: string, locale: string, active: boolean) {
  // Can't deactivate default locale
  if (!active) {
    const translation = await prisma.portalTranslation.findUnique({
      where: { shop_locale: { shop, locale } },
    });
    if (translation?.isDefault) {
      throw new Error("Cannot deactivate the default locale");
    }
  }
  return prisma.portalTranslation.update({
    where: { shop_locale: { shop, locale } },
    data: { active },
  });
}

export async function deleteTranslation(shop: string, locale: string) {
  const translation = await prisma.portalTranslation.findUnique({
    where: { shop_locale: { shop, locale } },
  });
  if (translation?.isDefault) {
    throw new Error("Cannot delete the default locale");
  }
  return prisma.portalTranslation.delete({
    where: { shop_locale: { shop, locale } },
  });
}

export async function updateTranslationMessage(
  shop: string,
  locale: string,
  key: string,
  value: string,
) {
  const translation = await prisma.portalTranslation.findUnique({
    where: { shop_locale: { shop, locale } },
  });
  if (!translation) {
    throw new Error(`Translation not found for locale: ${locale}`);
  }
  const messages = (translation.messages && typeof translation.messages === "object" ? translation.messages : {}) as Record<string, string>;
  messages[key] = value;
  return prisma.portalTranslation.update({
    where: { shop_locale: { shop, locale } },
    data: { messages },
  });
}
