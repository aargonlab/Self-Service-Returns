import { json } from "@remix-run/node";
import { encryptCredential, decryptCredential } from "~/utils/encryption.server";
import { getSettings, updateSettings } from "~/models/returnSettings.server";
import { signPayload } from "~/services/webhook.server";
import { settingsSchema, validateExternalUrl } from "~/utils/validators";
import { createApiKey, revokeApiKey, deleteApiKey } from "~/services/api.auth.server";
import type { ApiScope } from "~/services/api.auth.server";
import { getShippingProvider } from "~/models/shippingProvider.server";
import { createWarehouse, updateWarehouse, deleteWarehouse } from "~/models/returnWarehouse.server";
import { createRoutingRule, updateRoutingRule, deleteRoutingRule } from "~/models/returnRoutingRule.server";

export async function handleCreateApiKey(formData: FormData, shop: string) {
  const name = formData.get("keyName") as string;
  if (!name?.trim()) {
    return json({ success: false, error: "Key name is required.", intent: "create-api-key" }, { status: 400 });
  }
  const scopes: ApiScope[] = ["returns:read", "returns:write", "settings:read", "settings:write"];
  const result = await createApiKey(shop, name.trim(), scopes);
  return json({ success: true, intent: "create-api-key", apiKey: result.plaintext, keyId: result.id });
}

export async function handleRevokeApiKey(formData: FormData, shop: string) {
  const keyId = formData.get("keyId") as string;
  if (!keyId?.trim()) {
    return json({ success: false, error: "Key ID is required" }, { status: 400 });
  }
  if (!/^c[a-z0-9]{24,}$/i.test(keyId.trim())) {
    return json({ success: false, error: "Invalid key ID format" }, { status: 400 });
  }
  await revokeApiKey(shop, keyId);
  return json({ success: true, intent: "revoke-api-key" });
}

export async function handleDeleteApiKey(formData: FormData, shop: string) {
  const keyId = formData.get("keyId") as string;
  if (!keyId?.trim()) {
    return json({ success: false, error: "Key ID is required" }, { status: 400 });
  }
  if (!/^c[a-z0-9]{24,}$/i.test(keyId.trim())) {
    return json({ success: false, error: "Invalid key ID format" }, { status: 400 });
  }
  await deleteApiKey(shop, keyId);
  return json({ success: true, intent: "delete-api-key" });
}

export async function handleSaveShippingProvider(formData: FormData, shop: string) {
  const apiKey = (formData.get("providerApiKey") as string)?.trim();
  const environment = (formData.get("providerEnvironment") as string)?.trim() || "TEST";
  const shipEndpoint = (formData.get("providerShipEndpoint") as string)?.trim() || undefined;
  const trackEndpoint = (formData.get("providerTrackEndpoint") as string)?.trim() || undefined;

  if (!apiKey) {
    return json({ success: false, error: "API Key is required.", intent: "save-shipping-provider" }, { status: 400 });
  }

  const { testConnection } = await import("~/services/processWeaver.testConnection.server");
  const testResult = await testConnection({
    shipEndpoint: shipEndpoint || "https://shippingapi.processweaver.com/ShippingAPI/Api/Ship",
    apiKey,
    environment: environment as "TEST" | "PROD",
  });

  const { upsertShippingProvider } = await import("~/models/shippingProvider.server");
  await upsertShippingProvider(shop, {
    apiKey,
    environment,
    shipEndpoint,
    trackEndpoint,
    active: testResult.success,
  });

  if (!testResult.success) {
    return json({
      success: false,
      error: `Connection test failed: ${testResult.message}`,
      connectionTest: testResult,
      intent: "save-shipping-provider",
    }, { status: 400 });
  }

  return json({
    success: true,
    intent: "save-shipping-provider",
    connectionTest: testResult,
  });
}

export async function handleTestShippingConnection(shop: string) {
  const provider = await getShippingProvider(shop);
  if (!provider) {
    return json({ success: false, error: "No shipping provider configured.", intent: "test-shipping-connection" }, { status: 400 });
  }

  const { testConnection } = await import("~/services/processWeaver.testConnection.server");
  const testResult = await testConnection({
    shipEndpoint: provider.shipEndpoint || "https://shippingapi.processweaver.com/ShippingAPI/Api/Ship",
    apiKey: provider.apiKey,
    environment: provider.environment as "TEST" | "PROD",
  });

  const { upsertShippingProvider } = await import("~/models/shippingProvider.server");
  await upsertShippingProvider(shop, {
    apiKey: provider.apiKey,
    environment: provider.environment,
    shipEndpoint: provider.shipEndpoint,
    trackEndpoint: provider.trackEndpoint,
    active: testResult.success,
  });

  return json({
    success: testResult.success,
    error: testResult.success ? undefined : `Connection test failed: ${testResult.message}`,
    connectionTest: testResult,
    intent: "test-shipping-connection",
  }, { status: testResult.success ? 200 : 400 });
}

export async function handleDeleteShippingProvider(shop: string) {
  const { deleteShippingProvider } = await import("~/models/shippingProvider.server");
  try {
    await deleteShippingProvider(shop);
    return json({ success: true, intent: "delete-shipping-provider" });
  } catch {
    return json({ success: false, error: "Failed to delete shipping provider.", intent: "delete-shipping-provider" }, { status: 400 });
  }
}

export async function handleCreateCarrierAccount(formData: FormData, shop: string) {
  const name = (formData.get("carrierName") as string)?.trim();
  const carrierCode = (formData.get("carrierCode") as string)?.trim();
  const accountNumber = (formData.get("carrierAccountNumber") as string)?.trim();

  if (!name || !carrierCode || !accountNumber) {
    return json({ success: false, error: "Name, carrier code, and account number are required.", intent: "create-carrier-account" }, { status: 400 });
  }

  const provider = await getShippingProvider(shop);
  if (!provider) {
    return json({ success: false, error: "Please configure a shipping provider first.", intent: "create-carrier-account" }, { status: 400 });
  }

  const { createCarrierAccount } = await import("~/models/carrierAccount.server");
  try {
    await createCarrierAccount(shop, {
      providerId: provider.id,
      name,
      carrierCode: carrierCode.toUpperCase(),
      accountNumber,
      userId: (formData.get("carrierUserId") as string)?.trim() || null,
      password: (formData.get("carrierPassword") as string)?.trim() || null,
      meterNumber: (formData.get("carrierMeterNumber") as string)?.trim() || null,
      serviceType: (formData.get("carrierServiceType") as string)?.trim() || null,
      paymentType: (formData.get("carrierPaymentType") as string)?.trim() || "SENDER",
      shipDateFormat: (formData.get("carrierShipDateFormat") as string)?.trim() || "yyyy-MM-dd",
      labelFormat: (formData.get("carrierLabelFormat") as string)?.trim() || "PNG",
    });
    return json({ success: true, intent: "create-carrier-account" });
  } catch (err: any) {
    const isDuplicate = err?.code === "P2002";
    return json({
      success: false,
      error: isDuplicate ? "A carrier account with this code and name already exists." : "Failed to create carrier account.",
      intent: "create-carrier-account"
    }, { status: 400 });
  }
}

export async function handleUpdateCarrierAccount(formData: FormData, shop: string) {
  const carrierId = (formData.get("carrierId") as string)?.trim();
  if (!carrierId) {
    return json({ success: false, error: "Carrier account ID is required.", intent: "update-carrier-account" }, { status: 400 });
  }

  const { updateCarrierAccount } = await import("~/models/carrierAccount.server");
  try {
    await updateCarrierAccount(carrierId, shop, {
      name: (formData.get("carrierName") as string)?.trim() || undefined,
      carrierCode: (formData.get("carrierCode") as string)?.trim()?.toUpperCase() || undefined,
      accountNumber: (formData.get("carrierAccountNumber") as string)?.trim() || undefined,
      userId: (formData.get("carrierUserId") as string)?.trim() || null,
      password: (formData.get("carrierPassword") as string)?.trim() || null,
      meterNumber: (formData.get("carrierMeterNumber") as string)?.trim() || null,
      serviceType: (formData.get("carrierServiceType") as string)?.trim() || null,
      paymentType: (formData.get("carrierPaymentType") as string)?.trim() || "SENDER",
      shipDateFormat: (formData.get("carrierShipDateFormat") as string)?.trim() || "yyyy-MM-dd",
      labelFormat: (formData.get("carrierLabelFormat") as string)?.trim() || "PNG",
      active: formData.get("carrierActive") !== "false",
    });
    return json({ success: true, intent: "update-carrier-account" });
  } catch {
    return json({ success: false, error: "Failed to update carrier account.", intent: "update-carrier-account" }, { status: 400 });
  }
}

export async function handleDeleteCarrierAccount(formData: FormData, shop: string) {
  const carrierId = (formData.get("carrierId") as string)?.trim();
  if (!carrierId) {
    return json({ success: false, error: "Carrier account ID is required.", intent: "delete-carrier-account" }, { status: 400 });
  }

  const { deleteCarrierAccount } = await import("~/models/carrierAccount.server");
  try {
    await deleteCarrierAccount(carrierId, shop);
    return json({ success: true, intent: "delete-carrier-account" });
  } catch {
    return json({ success: false, error: "Failed to delete carrier account.", intent: "delete-carrier-account" }, { status: 400 });
  }
}

export async function handleCreateWarehouse(formData: FormData, shop: string) {
  const name = (formData.get("warehouseName") as string)?.trim();
  const address1 = (formData.get("warehouseAddress1") as string)?.trim();
  const city = (formData.get("warehouseCity") as string)?.trim();
  const zip = (formData.get("warehouseZip") as string)?.trim();
  const country = (formData.get("warehouseCountry") as string)?.trim();
  if (!name || !address1 || !city || !zip || !country) {
    return json({ success: false, error: "Name, address, city, ZIP, and country are required.", intent: "create-warehouse" }, { status: 400 });
  }
  await createWarehouse(shop, {
    name,
    address1,
    address2: (formData.get("warehouseAddress2") as string)?.trim() || undefined,
    city,
    province: (formData.get("warehouseProvince") as string)?.trim() || undefined,
    zip,
    country,
    countryCode: (formData.get("warehouseCountryCode") as string)?.trim() || undefined,
    phone: (formData.get("warehousePhone") as string)?.trim() || undefined,
    email: (formData.get("warehouseEmail") as string)?.trim() || undefined,
    isDefault: formData.get("warehouseIsDefault") === "true",
  });
  return json({ success: true, intent: "create-warehouse" });
}

export async function handleUpdateWarehouse(formData: FormData, shop: string) {
  const warehouseId = (formData.get("warehouseId") as string)?.trim();
  if (!warehouseId) {
    return json({ success: false, error: "Warehouse ID is required.", intent: "update-warehouse" }, { status: 400 });
  }
  const name = (formData.get("warehouseName") as string)?.trim();
  const address1 = (formData.get("warehouseAddress1") as string)?.trim();
  const city = (formData.get("warehouseCity") as string)?.trim();
  const zip = (formData.get("warehouseZip") as string)?.trim();
  const country = (formData.get("warehouseCountry") as string)?.trim();
  if (!name || !address1 || !city || !zip || !country) {
    return json({ success: false, error: "Name, address, city, ZIP, and country are required.", intent: "update-warehouse" }, { status: 400 });
  }
  await updateWarehouse(warehouseId, shop, {
    name,
    address1,
    address2: (formData.get("warehouseAddress2") as string)?.trim() || null,
    city,
    province: (formData.get("warehouseProvince") as string)?.trim() || null,
    zip,
    country,
    countryCode: (formData.get("warehouseCountryCode") as string)?.trim() || null,
    phone: (formData.get("warehousePhone") as string)?.trim() || null,
    email: (formData.get("warehouseEmail") as string)?.trim() || null,
    isDefault: formData.get("warehouseIsDefault") === "true",
  });
  return json({ success: true, intent: "update-warehouse" });
}

export async function handleDeleteWarehouse(formData: FormData, shop: string) {
  const warehouseId = (formData.get("warehouseId") as string)?.trim();
  if (!warehouseId) {
    return json({ success: false, error: "Warehouse ID is required.", intent: "delete-warehouse" }, { status: 400 });
  }
  try {
    await deleteWarehouse(warehouseId, shop);
    return json({ success: true, intent: "delete-warehouse" });
  } catch (err) {
    return json({ success: false, error: "Cannot delete warehouse. It may have routing rules assigned.", intent: "delete-warehouse" }, { status: 400 });
  }
}

export async function handleCreateRoutingRule(formData: FormData, shop: string) {
  const warehouseId = (formData.get("ruleWarehouseId") as string)?.trim();
  if (!warehouseId) {
    return json({ success: false, error: "Warehouse is required.", intent: "create-routing-rule" }, { status: 400 });
  }
  const marketId = (formData.get("ruleMarketId") as string)?.trim() || null;
  const marketName = (formData.get("ruleMarketName") as string)?.trim() || null;
  const returnInstructions = (formData.get("ruleReturnInstructions") as string)?.trim() || null;
  const carrierAccountId = (formData.get("ruleCarrierAccountId") as string)?.trim() || null;

  try {
    await createRoutingRule(shop, {
      marketId,
      marketName,
      warehouseId,
      returnInstructions,
      carrierAccountId,
    });
    return json({ success: true, intent: "create-routing-rule" });
  } catch (err: any) {
    const isDuplicate = err?.code === "P2002";
    return json({
      success: false,
      error: isDuplicate ? "A routing rule for this market and shipping method already exists." : "Failed to create routing rule.",
      intent: "create-routing-rule"
    }, { status: 400 });
  }
}

export async function handleUpdateRoutingRule(formData: FormData, shop: string) {
  const ruleId = (formData.get("ruleId") as string)?.trim();
  if (!ruleId) {
    return json({ success: false, error: "Rule ID is required.", intent: "update-routing-rule" }, { status: 400 });
  }
  const warehouseId = (formData.get("ruleWarehouseId") as string)?.trim();
  const returnInstructions = (formData.get("ruleReturnInstructions") as string)?.trim() || null;
  const carrierAccountId = (formData.get("ruleCarrierAccountId") as string)?.trim() || null;
  const active = formData.get("ruleActive") !== "false";

  try {
    await updateRoutingRule(ruleId, shop, {
      warehouseId,
      returnInstructions,
      carrierAccountId,
      active,
    });
    return json({ success: true, intent: "update-routing-rule" });
  } catch {
    return json({ success: false, error: "Failed to update routing rule.", intent: "update-routing-rule" }, { status: 400 });
  }
}

export async function handleDeleteRoutingRule(formData: FormData, shop: string) {
  const ruleId = (formData.get("ruleId") as string)?.trim();
  if (!ruleId) {
    return json({ success: false, error: "Rule ID is required.", intent: "delete-routing-rule" }, { status: 400 });
  }
  try {
    await deleteRoutingRule(ruleId, shop);
    return json({ success: true, intent: "delete-routing-rule" });
  } catch {
    return json({ success: false, error: "Failed to delete routing rule.", intent: "delete-routing-rule" }, { status: 400 });
  }
}

export async function handleToggleLocale(formData: FormData, shop: string) {
  const locale = formData.get("locale") as string;
  const active = formData.get("active") === "true";
  if (!locale) return json({ success: false, error: "Locale required" }, { status: 400 });

  const { toggleTranslationActive } = await import("~/models/portalTranslation.server");
  try {
    await toggleTranslationActive(shop, locale, active);
    return json({ success: true, intent: "toggle-locale" });
  } catch (err: any) {
    return json({ success: false, error: err.message || "Failed to toggle locale" }, { status: 400 });
  }
}

export async function handleSetDefaultLocale(formData: FormData, shop: string) {
  const locale = formData.get("locale") as string;
  if (!locale) return json({ success: false, error: "Locale required" }, { status: 400 });

  const { setDefaultLocale } = await import("~/models/portalTranslation.server");
  try {
    await setDefaultLocale(shop, locale);
    return json({ success: true, intent: "set-default-locale" });
  } catch (err: any) {
    return json({ success: false, error: err.message || "Failed to set default locale" }, { status: 400 });
  }
}

export async function handleActivateLocale(formData: FormData, shop: string) {
  const locale = formData.get("locale") as string;
  if (!locale) return json({ success: false, error: "Locale required" }, { status: 400 });

  const { upsertTranslation } = await import("~/models/portalTranslation.server");
  try {
    await upsertTranslation(shop, locale, {});
    return json({ success: true, intent: "activate-locale" });
  } catch (err: any) {
    return json({ success: false, error: err.message || "Failed to activate locale" }, { status: 400 });
  }
}

export async function handleSaveTranslationOverride(formData: FormData, shop: string) {
  const locale = formData.get("locale") as string;
  const key = formData.get("key") as string;
  const value = formData.get("value") as string;
  if (!locale || !key) return json({ success: false, error: "Locale and key required" }, { status: 400 });

  const { updateTranslationMessage } = await import("~/models/portalTranslation.server");
  try {
    await updateTranslationMessage(shop, locale, key, value || "");
    return json({ success: true, intent: "save-translation-override" });
  } catch (err: any) {
    return json({ success: false, error: err.message || "Failed to save translation" }, { status: 400 });
  }
}

export async function handleTestWebhook(formData: FormData, shop: string) {
  const testUrl = formData.get("testWebhookUrl") as string;
  if (!testUrl) {
    return json({ success: false, error: "Webhook URL is required.", intent: "test-webhook" }, { status: 400 });
  }

  try {
    validateExternalUrl(testUrl, "Webhook test URL");
  } catch (err: any) {
    return json({ success: false, error: err.message, intent: "test-webhook" }, { status: 400 });
  }

  // Resolve the signing secret. Priority:
  //   1. Plaintext secret submitted from the form (user is editing, may not have saved yet).
  //   2. Encrypted secret persisted in settings, decrypted here.
  // If neither is present, the test fires without an HMAC header — same shape a receiver
  // would see when the shop hasn't configured a secret.
  const formSecret = (formData.get("testWebhookSecret") as string | null)?.trim() || "";
  let signingSecret = formSecret;
  if (!signingSecret) {
    try {
      const settings = await getSettings(shop);
      if (settings.webhookSecret) {
        signingSecret = decryptCredential(settings.webhookSecret);
      }
    } catch (err) {
      console.warn("[TestWebhook] Failed to load/decrypt persisted secret:", err);
    }
  }

  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    event: "test.ping",
    timestamp,
    shop,
    data: { message: "Test webhook from Self Service Return" },
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": "test.ping",
    "X-Webhook-Timestamp": timestamp,
  };
  if (signingSecret) {
    headers["X-Webhook-Signature"] = `sha256=${signPayload(body, signingSecret)}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(testUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      return json({
        success: true,
        intent: "test-webhook",
        signed: Boolean(signingSecret),
      });
    } else {
      return json(
        {
          success: false,
          error: `Webhook returned HTTP ${res.status}`,
          intent: "test-webhook",
          signed: Boolean(signingSecret),
        },
        { status: 400 },
      );
    }
  } catch (err: any) {
    const msg = err?.name === "AbortError" ? "Request timed out (5s)" : (err?.message || "Connection failed");
    return json(
      { success: false, error: msg, intent: "test-webhook", signed: Boolean(signingSecret) },
      { status: 400 },
    );
  }
}

export async function handleSaveSettings(formData: FormData, shop: string) {
  const returnWindowDaysRaw = parseInt(formData.get("returnWindowDays") as string) || 30;
  if (returnWindowDaysRaw < 1 || returnWindowDaysRaw > 365) {
    return json({ success: false, error: "Return window must be between 1 and 365 days" }, { status: 400 });
  }
  const returnWindowDays = returnWindowDaysRaw;
  const returnInstructions = formData.get("returnInstructions") as string;
  const autoApprove = formData.get("autoApprove") === "true";
  const autoApproveReplacements = formData.get("autoApproveReplacements") === "true";
  const enableReplacement = formData.get("enableReplacement") === "true";
  const enableRxGrouping = formData.get("enableRxGrouping") === "true";
  const excludeReplacementForRxGroup = formData.get("excludeReplacementForRxGroup") === "true";
  const enableSerialNumbers = formData.get("enableSerialNumbers") === "true";
  const logoUrl = (formData.get("logoUrl") as string) || null;
  const portalLogoPosition = (formData.get("portalLogoPosition") as string) || "left";
  const portalButtonColor = (formData.get("portalButtonColor") as string) || null;
  const portalButtonTextColor = (formData.get("portalButtonTextColor") as string) || null;
  const portalTextColor = (formData.get("portalTextColor") as string) || null;
  const portalHeadingFont = (formData.get("portalHeadingFont") as string) || "sans-serif";
  const portalBodyFont = (formData.get("portalBodyFont") as string) || "sans-serif";
  const webhookUrl = (formData.get("webhookUrl") as string) || null;
  const webhookSecretRaw = (formData.get("webhookSecret") as string) || null;
  const webhookSecret = webhookSecretRaw ? encryptCredential(webhookSecretRaw) : null;
  const webhookActive = formData.get("webhookActive") === "true";
  // Default to true when the field is absent (e.g. older clients) to preserve the existing OTP requirement.
  const requireRefundOtpRaw = formData.get("requireRefundOtp");
  const requireRefundOtp = requireRefundOtpRaw === null ? undefined : requireRefundOtpRaw === "true";

  const webhookEventsRaw = formData.get("webhookEvents") as string;
  let webhookEvents: string[] | undefined;
  try {
    if (webhookEventsRaw) {
      const parsed = JSON.parse(webhookEventsRaw);
      if (Array.isArray(parsed)) {
        webhookEvents = parsed.filter((e: any) => typeof e === "string");
      }
    }
  } catch (e) {
    console.warn("[Settings] Failed to parse webhookEvents JSON:", e);
  }

  const webhookStatusFiltersRaw = formData.get("webhookStatusFilters") as string;
  let webhookStatusFilters: string[] | undefined;
  try {
    if (webhookStatusFiltersRaw) {
      const parsed = JSON.parse(webhookStatusFiltersRaw);
      if (Array.isArray(parsed)) {
        webhookStatusFilters = parsed.filter((s: any) => typeof s === "string");
      }
    }
  } catch (e) {
    console.warn("[Settings] Failed to parse webhookStatusFilters JSON:", e);
  }

  const marketReturnWindowsRaw = formData.get("marketReturnWindows") as string;
  let marketReturnWindows = null;
  try {
    if (marketReturnWindowsRaw) {
      let parsed = JSON.parse(marketReturnWindowsRaw);
      if (!Array.isArray(parsed)) parsed = [];
      const validated = parsed.filter((item: any) =>
        item && typeof item.marketId === "string" && typeof item.returnWindowDays === "number" &&
        item.returnWindowDays > 0 && item.returnWindowDays <= 365
      );
      marketReturnWindows = validated.length > 0 ? validated : null;
    }
  } catch (e) {
    console.warn("[Settings] Failed to parse marketReturnWindows JSON:", e);
  }

  const parsed = settingsSchema.safeParse({
    returnWindowDays,
    allowedReasons: ["ALL"],
    returnInstructions: returnInstructions || undefined,
    autoApprove,
    enableReplacement,
  });

  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return json(
      { success: false, error: firstError || "Invalid settings." },
      { status: 400 },
    );
  }

  await updateSettings(shop, {
    returnWindowDays,
    allowedReasons: ["ALL"],
    returnInstructions: returnInstructions || undefined,
    autoApprove,
    autoApproveReplacements,
    enableReplacement,
    logoUrl,
    portalLogoPosition,
    portalButtonColor,
    portalButtonTextColor,
    portalTextColor,
    portalHeadingFont,
    portalBodyFont,
    marketReturnWindows,
    enableRxGrouping,
    excludeReplacementForRxGroup,
    enableSerialNumbers,
    webhookUrl,
    webhookSecret,
    webhookActive,
    webhookEvents,
    webhookStatusFilters,
    requireRefundOtp,
  });

  return json({ success: true, error: null });
}
