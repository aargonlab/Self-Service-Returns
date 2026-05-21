import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form, useFetcher, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  TextField,
  Checkbox,
  Button,
  Banner,
  InlineStack,
  Box,
  Badge,
  Divider,
  Modal,
  Select,
  Tabs,
  SkeletonPage,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import { getSettings } from "~/models/returnSettings.server";
import { decryptCredential } from "~/utils/encryption.server";
import { listApiKeys } from "~/services/api.auth.server";
import { fetchMarkets } from "~/services/shopifyMarkets.server";
import { listWarehouses } from "~/models/returnWarehouse.server";
import { listRoutingRules } from "~/models/returnRoutingRule.server";
import { getActiveTranslations } from "~/models/portalTranslation.server";
import { SUPPORTED_LOCALES } from "~/utils/portalTranslations";
import { getShippingProvider } from "~/models/shippingProvider.server";
import { listCarrierAccounts } from "~/models/carrierAccount.server";
import { TranslationsTab } from "~/components/admin/settings/TranslationsTab";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "";
  const portalUrl = appUrl ? `${appUrl}/returns?shop=${session.shop}` : "";
  const apiKeys = await listApiKeys(session.shop);
  const { markets } = await fetchMarkets(admin);

  // Parse market return windows from JSON
  const marketReturnWindows = Array.isArray(settings.marketReturnWindows)
    ? settings.marketReturnWindows as Array<{ marketId: string; marketName: string; returnWindowDays: number }>
    : [];

  const warehouses = await listWarehouses(session.shop);
  const routingRules = await listRoutingRules(session.shop);
  let portalTranslations: Awaited<ReturnType<typeof getActiveTranslations>> = [];
  try {
    portalTranslations = await getActiveTranslations(session.shop);
  } catch {
    // PortalTranslation table may not exist yet (migration pending)
  }

  let shippingProvider: Awaited<ReturnType<typeof getShippingProvider>> = null;
  let carrierAccounts: Awaited<ReturnType<typeof listCarrierAccounts>> = [];
  try {
    shippingProvider = await getShippingProvider(session.shop);
    carrierAccounts = await listCarrierAccounts(session.shop);
  } catch {
    // ShippingProvider/CarrierAccount tables may not exist yet (migration pending)
  }

  // Load reasons for translation editor
  const { listReasons } = await import("~/models/customReason.server");
  let allReasons: Awaited<ReturnType<typeof listReasons>> = [];
  try {
    allReasons = await listReasons(session.shop);
  } catch {
    // CustomReason table may not exist yet (migration pending)
  }

  // Decrypt webhook secret (backward-compatible with plaintext)
  if (settings.webhookSecret) {
    try {
      settings.webhookSecret = decryptCredential(settings.webhookSecret);
    } catch (error) {
      console.error("[Settings] Failed to decrypt webhook secret:", error);
      settings.webhookSecret = null;
    }
  }

  return json(
    { settings, portalUrl, apiKeys, markets, marketReturnWindows, warehouses, routingRules, portalTranslations, supportedLocales: SUPPORTED_LOCALES, shippingProvider, carrierAccounts, allReasons },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const {
    handleCreateApiKey,
    handleRevokeApiKey,
    handleDeleteApiKey,
    handleSaveShippingProvider,
    handleTestShippingConnection,
    handleDeleteShippingProvider,
    handleCreateCarrierAccount,
    handleUpdateCarrierAccount,
    handleDeleteCarrierAccount,
    handleCreateWarehouse,
    handleUpdateWarehouse,
    handleDeleteWarehouse,
    handleCreateRoutingRule,
    handleUpdateRoutingRule,
    handleDeleteRoutingRule,
    handleToggleLocale,
    handleSetDefaultLocale,
    handleActivateLocale,
    handleSaveTranslationOverride,
    handleTestWebhook,
    handleSaveSettings,
  } = await import("~/services/settingsActions.server");

  // Dispatch to intent handlers
  switch (intent) {
    case "create-api-key":
      return handleCreateApiKey(formData, session.shop);
    case "revoke-api-key":
      return handleRevokeApiKey(formData, session.shop);
    case "delete-api-key":
      return handleDeleteApiKey(formData, session.shop);
    case "save-shipping-provider":
      return handleSaveShippingProvider(formData, session.shop);
    case "test-shipping-connection":
      return handleTestShippingConnection(session.shop);
    case "delete-shipping-provider":
      return handleDeleteShippingProvider(session.shop);
    case "create-carrier-account":
      return handleCreateCarrierAccount(formData, session.shop);
    case "update-carrier-account":
      return handleUpdateCarrierAccount(formData, session.shop);
    case "delete-carrier-account":
      return handleDeleteCarrierAccount(formData, session.shop);
    case "create-warehouse":
      return handleCreateWarehouse(formData, session.shop);
    case "update-warehouse":
      return handleUpdateWarehouse(formData, session.shop);
    case "delete-warehouse":
      return handleDeleteWarehouse(formData, session.shop);
    case "create-routing-rule":
      return handleCreateRoutingRule(formData, session.shop);
    case "update-routing-rule":
      return handleUpdateRoutingRule(formData, session.shop);
    case "delete-routing-rule":
      return handleDeleteRoutingRule(formData, session.shop);
    case "toggle-locale":
      return handleToggleLocale(formData, session.shop);
    case "set-default-locale":
      return handleSetDefaultLocale(formData, session.shop);
    case "activate-locale":
      return handleActivateLocale(formData, session.shop);
    case "save-translation-override":
      return handleSaveTranslationOverride(formData, session.shop);
    case "test-webhook":
      return handleTestWebhook(formData, session.shop);
    default:
      return handleSaveSettings(formData, session.shop);
  }
};

export default function Settings() {
  const { settings, portalUrl, apiKeys, markets, marketReturnWindows: initialMarketReturnWindows, warehouses, routingRules, portalTranslations, supportedLocales, shippingProvider, carrierAccounts, allReasons } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [returnWindowDays, setReturnWindowDays] = useState(
    String(settings.returnWindowDays),
  );
  const [returnInstructions, setReturnInstructions] = useState(
    settings.returnInstructions || "",
  );
  const [autoApprove, setAutoApprove] = useState(settings.autoApprove);
  const [autoApproveReplacements, setAutoApproveReplacements] = useState(settings.autoApproveReplacements ?? false);
  const [enableReplacement, setEnableReplacement] = useState(settings.enableReplacement);
  const [enableRxGrouping, setEnableRxGrouping] = useState(settings.enableRxGrouping);
  const [excludeReplacementForRxGroup, setExcludeReplacementForRxGroup] = useState(settings.excludeReplacementForRxGroup ?? false);
  const [enableSerialNumbers, setEnableSerialNumbers] = useState(settings.enableSerialNumbers ?? false);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || "");
  const [portalLogoPosition, setPortalLogoPosition] = useState(settings.portalLogoPosition || "left");
  const [portalButtonColor, setPortalButtonColor] = useState(settings.portalButtonColor || "#0284c7");
  const [portalButtonTextColor, setPortalButtonTextColor] = useState(settings.portalButtonTextColor || "#ffffff");
  const [portalTextColor, setPortalTextColor] = useState(settings.portalTextColor || "#374151");
  const [portalHeadingFont, setPortalHeadingFont] = useState(settings.portalHeadingFont || "sans-serif");
  const [portalBodyFont, setPortalBodyFont] = useState(settings.portalBodyFont || "sans-serif");

  // Webhook state
  const [webhookUrl, setWebhookUrl] = useState(settings.webhookUrl || "");
  const [webhookSecret, setWebhookSecret] = useState(settings.webhookSecret || "");
  const [webhookActive, setWebhookActive] = useState(settings.webhookActive ?? false);
  const [requireRefundOtp, setRequireRefundOtp] = useState(settings.requireRefundOtp ?? true);

  const ALL_WEBHOOK_EVENTS = [
    { value: "return.submitted", label: "Return Submitted" },
    { value: "return.approved", label: "Return Approved" },
    { value: "return.rejected", label: "Return Rejected" },
    { value: "return.cancelled", label: "Return Cancelled" },
    { value: "return.status_changed", label: "Status Changed" },
    { value: "refund.processed", label: "Refund Processed" },
    { value: "replacement.processed", label: "Replacement Processed" },
    { value: "disclaimer.accepted", label: "Disclaimer Accepted" },
  ] as const;

  const defaultEvents = ALL_WEBHOOK_EVENTS.map(e => e.value);
  const initialWebhookEvents = Array.isArray(settings.webhookEvents)
    ? settings.webhookEvents as string[]
    : defaultEvents;
  const [webhookEvents, setWebhookEvents] = useState<string[]>(initialWebhookEvents);

  const toggleWebhookEvent = useCallback((event: string) => {
    setWebhookEvents(prev =>
      prev.includes(event)
        ? prev.filter(e => e !== event)
        : [...prev, event]
    );
  }, []);

  const ALL_RETURN_STATUSES = [
    { value: "AWAITING_SHIPMENT", label: "Awaiting Shipment" },
    { value: "IN_TRANSIT", label: "In Transit" },
    { value: "RECEIVED", label: "Received" },
    { value: "PARTIALLY_ACCEPTED", label: "Partially Accepted" },
    { value: "REFUNDED", label: "Refunded" },
    { value: "EXCHANGED", label: "Replaced" },
    { value: "CLOSED", label: "Closed" },
    { value: "CANCELLED", label: "Cancelled" },
  ] as const;

  const initialStatusFilters = Array.isArray(settings.webhookStatusFilters)
    ? settings.webhookStatusFilters as string[]
    : [];
  const [webhookStatusFilters, setWebhookStatusFilters] = useState<string[]>(initialStatusFilters);

  const toggleStatusFilter = useCallback((status: string) => {
    setWebhookStatusFilters(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
  }, []);

  // Market return windows state
  const [marketReturnWindows, setMarketReturnWindows] = useState<Array<{ marketId: string; marketName: string; returnWindowDays: number }>>(
    initialMarketReturnWindows
  );
  const [showAddMarketWindow, setShowAddMarketWindow] = useState(false);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [newMarketWindowDays, setNewMarketWindowDays] = useState("30");

  // API Key state
  const keyFetcher = useFetcher();
  const [createKeyModalOpen, setCreateKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [actingOnKeyId, setActingOnKeyId] = useState<string | null>(null);
  const [keyError, setKeyError] = useState("");

  // Webhook state
  const webhookFetcher = useFetcher();

  // Shipping & Routing state
  const shippingFetcher = useFetcher();
  const [shippingBannerDismissed, setShippingBannerDismissed] = useState(false);
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<string | null>(null);
  const [showRoutingForm, setShowRoutingForm] = useState(false);
  const [editingRule, setEditingRule] = useState<string | null>(null);

  // ProcessWeaver Provider state
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerApiKey, setProviderApiKey] = useState(shippingProvider?.apiKey || "");
  const [providerEnvironment, setProviderEnvironment] = useState(shippingProvider?.environment || "TEST");
  const [providerShipEndpoint, setProviderShipEndpoint] = useState(shippingProvider?.shipEndpoint || "https://shippingapi.processweaver.com/ShippingAPI/Api/Ship");
  const [providerTrackEndpoint, setProviderTrackEndpoint] = useState(shippingProvider?.trackEndpoint || "https://shippingapi.processweaver.com/TrackAPI/Api/Track");
  // labelFormat is per carrier, not per provider

  // Carrier Account state
  const [showCarrierForm, setShowCarrierForm] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState<string | null>(null);
  const [caName, setCaName] = useState("");
  const [caCarrierCode, setCaCarrierCode] = useState("");
  const [caAccountNumber, setCaAccountNumber] = useState("");
  const [caUserId, setCaUserId] = useState("");
  const [caPassword, setCaPassword] = useState("");
  const [caMeterNumber, setCaMeterNumber] = useState("");
  const [caServiceType, setCaServiceType] = useState("");
  const [caPaymentType, setCaPaymentType] = useState("SENDER");
  const [caShipDateFormat, setCaShipDateFormat] = useState("yyyy-MM-dd");
  const [caLabelFormat, setCaLabelFormat] = useState("PNG");

  // Warehouse form fields
  const [whName, setWhName] = useState("");
  const [whAddress1, setWhAddress1] = useState("");
  const [whAddress2, setWhAddress2] = useState("");
  const [whCity, setWhCity] = useState("");
  const [whProvince, setWhProvince] = useState("");
  const [whZip, setWhZip] = useState("");
  const [whCountry, setWhCountry] = useState("");
  const [whCountryCode, setWhCountryCode] = useState("");
  const [whPhone, setWhPhone] = useState("");
  const [whEmail, setWhEmail] = useState("");
  const [whIsDefault, setWhIsDefault] = useState(false);

  // Routing rule form fields
  const [ruleMarketId, setRuleMarketId] = useState("");
  const [ruleWarehouseId, setRuleWarehouseId] = useState("");
  const [ruleReturnInstructions, setRuleReturnInstructions] = useState("");
  const [ruleCarrierAccountId, setRuleCarrierAccountId] = useState("");

  // Copy feedback state
  const [copiedPortalUrl, setCopiedPortalUrl] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);

  // Banner dismissal state
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Bug #242 Fix: Logo error state
  const [logoError, setLogoError] = useState(false);

  // Refs for timeout cleanup
  const copyPortalTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const copyApiKeyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Tab state
  const [selectedTab, setSelectedTab] = useState(0);

  const hasChanges =
    returnWindowDays !== String(settings.returnWindowDays) ||
    returnInstructions !== (settings.returnInstructions ?? "") ||
    autoApprove !== settings.autoApprove ||
    autoApproveReplacements !== (settings.autoApproveReplacements ?? false) ||
    enableReplacement !== settings.enableReplacement ||
    enableRxGrouping !== settings.enableRxGrouping ||
    excludeReplacementForRxGroup !== (settings.excludeReplacementForRxGroup ?? false) ||
    enableSerialNumbers !== (settings.enableSerialNumbers ?? false) ||
    logoUrl !== (settings.logoUrl || "") ||
    portalLogoPosition !== (settings.portalLogoPosition || "left") ||
    portalButtonColor !== (settings.portalButtonColor || "#0284c7") ||
    portalButtonTextColor !== (settings.portalButtonTextColor || "#ffffff") ||
    portalTextColor !== (settings.portalTextColor || "#374151") ||
    portalHeadingFont !== (settings.portalHeadingFont || "sans-serif") ||
    portalBodyFont !== (settings.portalBodyFont || "sans-serif") ||
    webhookUrl !== (settings.webhookUrl || "") ||
    webhookSecret !== (settings.webhookSecret || "") ||
    webhookActive !== (settings.webhookActive ?? false) ||
    requireRefundOtp !== (settings.requireRefundOtp ?? true) ||
    JSON.stringify(webhookEvents) !== JSON.stringify(initialWebhookEvents) ||
    JSON.stringify(webhookStatusFilters) !== JSON.stringify(initialStatusFilters) ||
    JSON.stringify(marketReturnWindows) !== JSON.stringify(initialMarketReturnWindows);

  // Capture newly created API key from fetcher response
  useEffect(() => {
    if (keyFetcher.data && (keyFetcher.data as any).intent === "create-api-key") {
      if ((keyFetcher.data as any).success) {
        setNewApiKey((keyFetcher.data as any).apiKey);
        setNewKeyName("");
        setCreateKeyModalOpen(false);
        setKeyError("");
      } else if ((keyFetcher.data as any).error) {
        setKeyError((keyFetcher.data as any).error);
      }
    }
  }, [keyFetcher.data]);

  // Clear acting key ID when fetcher is idle
  useEffect(() => {
    if (keyFetcher.state === "idle") {
      setActingOnKeyId(null);
    }
  }, [keyFetcher.state]);

  // Handle webhook test results
  useEffect(() => {
    if (webhookFetcher.data && (webhookFetcher.data as any).intent === "test-webhook") {
      const data = webhookFetcher.data as any;
      if (data.success) {
        shopify.toast.show(
          data.signed
            ? "Test webhook sent successfully (signed with HMAC)"
            : "Test webhook sent successfully (unsigned — no secret configured)"
        );
      } else {
        shopify.toast.show(data.error || "Test failed", { isError: true });
      }
    }
  }, [webhookFetcher.data]);

  // Reset banner dismissal when new actionData arrives
  useEffect(() => {
    if (actionData) {
      setBannerDismissed(false);
    }
  }, [actionData]);

  // Show toast for successful settings save
  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show("Settings saved successfully");
    }
  }, [actionData]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (copyPortalTimeoutRef.current) clearTimeout(copyPortalTimeoutRef.current);
      if (copyApiKeyTimeoutRef.current) clearTimeout(copyApiKeyTimeoutRef.current);
    };
  }, []);

  // Close shipping forms on successful fetcher responses and clear credentials
  useEffect(() => {
    if (shippingFetcher.state === "idle" && shippingFetcher.data) {
      setShippingBannerDismissed(false);
      const data = shippingFetcher.data as any;
      if (data.success) {
        if (data.intent?.includes("warehouse")) resetWarehouseForm();
        if (data.intent?.includes("routing-rule")) resetRoutingForm();
        if (data.intent?.includes("carrier-account")) resetCarrierForm();
        if (data.intent === "save-shipping-provider") setShowProviderForm(false);
        if (data.intent === "delete-shipping-provider") {
          // Clear all provider credentials from form state
          setProviderApiKey("");
          setProviderEnvironment("TEST");
          setProviderShipEndpoint("https://shippingapi.processweaver.com/ShippingAPI/Api/Ship");
          setProviderTrackEndpoint("https://shippingapi.processweaver.com/TrackAPI/Api/Track");
          setShowProviderForm(false);
        }
      }
    }
  }, [shippingFetcher.state, shippingFetcher.data]);

  // Bug #240 & #273 Fix: Remix already memoizes loader data per navigation
  const stableMarketReturnWindows = initialMarketReturnWindows;

  // Bug #197 Fix - Re-initialize state on navigation (when settings change)
  useEffect(() => {
    setReturnWindowDays(String(settings.returnWindowDays));
    setAutoApprove(settings.autoApprove);
    setAutoApproveReplacements(settings.autoApproveReplacements ?? false);
    setReturnInstructions(settings.returnInstructions || "");
    setEnableReplacement(settings.enableReplacement);
    setExcludeReplacementForRxGroup(settings.excludeReplacementForRxGroup ?? false);
    setLogoUrl(settings.logoUrl || "");
    setMarketReturnWindows(stableMarketReturnWindows);
    setRequireRefundOtp(settings.requireRefundOtp ?? true);
    setBannerDismissed(false);
    setLogoError(false);
  }, [settings, stableMarketReturnWindows]);

  const handleTabChange = useCallback((index: number) => setSelectedTab(index), []);

  // Helper functions for Shipping & Routing
  const resetWarehouseForm = useCallback(() => {
    setWhName(""); setWhAddress1(""); setWhAddress2(""); setWhCity("");
    setWhProvince(""); setWhZip(""); setWhCountry(""); setWhCountryCode("");
    setWhPhone(""); setWhEmail(""); setWhIsDefault(false);
    setEditingWarehouse(null); setShowWarehouseForm(false);
  }, []);

  const editWarehouse = useCallback((wh: any) => {
    setWhName(wh.name); setWhAddress1(wh.address1); setWhAddress2(wh.address2 || "");
    setWhCity(wh.city); setWhProvince(wh.province || ""); setWhZip(wh.zip);
    setWhCountry(wh.country); setWhCountryCode(wh.countryCode || "");
    setWhPhone(wh.phone || ""); setWhEmail(wh.email || ""); setWhIsDefault(wh.isDefault);
    setEditingWarehouse(wh.id); setShowWarehouseForm(true);
  }, []);

  const resetRoutingForm = useCallback(() => {
    setRuleMarketId(""); setRuleWarehouseId("");
    setRuleReturnInstructions(""); setRuleCarrierAccountId("");
    setEditingRule(null); setShowRoutingForm(false);
  }, []);

  const editRule = useCallback((rule: any) => {
    setRuleMarketId(rule.marketId || "");
    setRuleWarehouseId(rule.warehouseId);
    setRuleReturnInstructions(rule.returnInstructions || "");
    setRuleCarrierAccountId(rule.carrierAccountId || "");
    setEditingRule(rule.id); setShowRoutingForm(true);
  }, []);

  const resetCarrierForm = useCallback(() => {
    setCaName(""); setCaCarrierCode(""); setCaAccountNumber("");
    setCaUserId(""); setCaPassword(""); setCaMeterNumber("");
    setCaServiceType(""); setCaPaymentType("SENDER"); setCaShipDateFormat("yyyy-MM-dd");
    setCaLabelFormat("PNG"); setEditingCarrier(null); setShowCarrierForm(false);
  }, []);

  const editCarrier = useCallback((ca: any) => {
    setCaName(ca.name); setCaCarrierCode(ca.carrierCode);
    setCaAccountNumber(ca.accountNumber); setCaUserId(ca.userId || "");
    setCaPassword(ca.password || ""); setCaMeterNumber(ca.meterNumber || "");
    setCaServiceType(ca.serviceType || ""); setCaPaymentType(ca.paymentType || "SENDER");
    setCaShipDateFormat(ca.shipDateFormat || "yyyy-MM-dd");
    setCaLabelFormat(ca.labelFormat || "PNG");
    setEditingCarrier(ca.id); setShowCarrierForm(true);
  }, []);

  const tabs = useMemo(() => [
    { id: "general", content: "General", accessibilityLabel: "General settings" },
    { id: "branding", content: "Branding", accessibilityLabel: "Branding settings" },
    { id: "returns", content: "Returns", accessibilityLabel: "Return settings" },
    { id: "automation", content: "Automation", accessibilityLabel: "Automation settings" },
    { id: "shipping", content: "Shipping & Routing", accessibilityLabel: "Shipping and routing settings" },
    { id: "api-keys", content: "API Keys", accessibilityLabel: "API key management" },
    { id: "translations", content: "Translations", accessibilityLabel: "Portal translation settings" },
    { id: "webhooks", content: "Webhooks", accessibilityLabel: "Webhook settings" },
    { id: "refund-auth", content: "Refund Auth", accessibilityLabel: "Refund authorization settings" },
  ], []);

  if (navigation.state === "loading") {
    return (
      <SkeletonPage title="Return Settings">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={1} />
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.AnnotatedSection title="" description="">
            <Card>
              <SkeletonBodyText lines={3} />
            </Card>
          </Layout.AnnotatedSection>
          <Layout.AnnotatedSection title="" description="">
            <Card>
              <SkeletonBodyText lines={3} />
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </SkeletonPage>
    );
  }

  return (
    <Page title="Return Settings">
      {actionData && !bannerDismissed && (actionData as any).error && !(actionData as any).success && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone="critical" onDismiss={() => setBannerDismissed(true)}>
            <p>{(actionData as any).error}</p>
          </Banner>
        </div>
      )}

      <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
        <Form method="post">
          {/* All hidden inputs - always present regardless of tab */}
          <input type="hidden" name="marketReturnWindows" value={JSON.stringify(marketReturnWindows)} />
          <input type="hidden" name="autoApprove" value={String(autoApprove)} />
          <input type="hidden" name="autoApproveReplacements" value={String(autoApproveReplacements)} />
          <input type="hidden" name="enableReplacement" value={String(enableReplacement)} />
          <input type="hidden" name="returnWindowDays" value={returnWindowDays} />
          <input type="hidden" name="returnInstructions" value={returnInstructions} />
          <input type="hidden" name="logoUrl" value={logoUrl} />
          <input type="hidden" name="portalLogoPosition" value={portalLogoPosition} />
          <input type="hidden" name="portalButtonColor" value={portalButtonColor} />
          <input type="hidden" name="portalButtonTextColor" value={portalButtonTextColor} />
          <input type="hidden" name="portalTextColor" value={portalTextColor} />
          <input type="hidden" name="portalHeadingFont" value={portalHeadingFont} />
          <input type="hidden" name="portalBodyFont" value={portalBodyFont} />
          <input type="hidden" name="enableRxGrouping" value={String(enableRxGrouping)} />
          <input type="hidden" name="excludeReplacementForRxGroup" value={String(excludeReplacementForRxGroup)} />
          <input type="hidden" name="enableSerialNumbers" value={String(enableSerialNumbers)} />
          <input type="hidden" name="webhookUrl" value={webhookUrl} />
          <input type="hidden" name="webhookSecret" value={webhookSecret} />
          <input type="hidden" name="webhookActive" value={String(webhookActive)} />
          <input type="hidden" name="webhookEvents" value={JSON.stringify(webhookEvents)} />
          <input type="hidden" name="webhookStatusFilters" value={JSON.stringify(webhookStatusFilters)} />
          <input type="hidden" name="requireRefundOtp" value={String(requireRefundOtp)} />

          {/* Tab 0: General */}
          {selectedTab === 0 && (
            <Layout>
              {portalUrl && (
                <Layout.AnnotatedSection
                  title="Customer Portal"
                  description="Share this link with your customers so they can submit return requests."
                >
                  <Card>
                    <BlockStack gap="300">
                      <TextField
                        label="Portal URL"
                        value={portalUrl}
                        autoComplete="off"
                        readOnly
                        selectTextOnFocus
                        id="portal-url-input"
                      />
                      <InlineStack align="start">
                        <Button
                          onClick={async () => {
                            // Bug #211 Fix - Add error handling for clipboard copy
                            try {
                              await navigator.clipboard.writeText(portalUrl);
                              setCopiedPortalUrl(true);
                              if (copyPortalTimeoutRef.current) clearTimeout(copyPortalTimeoutRef.current);
                              copyPortalTimeoutRef.current = setTimeout(() => setCopiedPortalUrl(false), 2000);
                            } catch (err) {
                              // Fallback for older browsers
                              const input = document.getElementById('portal-url-input') as HTMLInputElement;
                              if (input) {
                                input.select();
                                try {
                                  document.execCommand('copy');
                                  setCopiedPortalUrl(true);
                                  if (copyPortalTimeoutRef.current) clearTimeout(copyPortalTimeoutRef.current);
                                  copyPortalTimeoutRef.current = setTimeout(() => setCopiedPortalUrl(false), 2000);
                                } catch {
                                  console.error("[Settings] Copy to clipboard failed");
                                }
                              }
                            }
                          }}
                        >
                          {copiedPortalUrl ? "Copied!" : "Copy Link"}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Layout.AnnotatedSection>
              )}

              <Layout.AnnotatedSection
                title="Return Window"
                description="The number of days after fulfillment that customers can request a return."
              >
                <Card>
                  <TextField
                    label="Return window (days)"
                    type="number"
                    value={returnWindowDays}
                    onChange={setReturnWindowDays}
                    min={1}
                    max={365}
                    autoComplete="off"
                    helpText="Customers can request a return within this many days of their order being fulfilled."
                  />
                </Card>
              </Layout.AnnotatedSection>

              <Layout.AnnotatedSection
                title="Market-Specific Return Windows"
                description="Override the default return window for specific markets."
              >
                <Card>
                  <BlockStack gap="400">
                    {marketReturnWindows.length > 0 && (
                      <BlockStack gap="300">
                        {marketReturnWindows.map((mw, index) => (
                          <Box
                            key={mw.marketId}
                            background="bg-surface-secondary"
                            padding="300"
                            borderRadius="200"
                          >
                            <InlineStack align="space-between" blockAlign="center">
                              <BlockStack gap="100">
                                <Text as="span" variant="bodyMd" fontWeight="semibold">
                                  {mw.marketName}
                                </Text>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {mw.returnWindowDays} days
                                </Text>
                              </BlockStack>
                              <InlineStack gap="200">
                                <Button
                                  size="slim"
                                  onClick={() => {
                                    setSelectedMarketId(mw.marketId);
                                    setNewMarketWindowDays(String(mw.returnWindowDays));
                                    setShowAddMarketWindow(true);
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="slim"
                                  tone="critical"
                                  variant="plain"
                                  onClick={() => {
                                    setMarketReturnWindows(marketReturnWindows.filter((_, i) => i !== index));
                                  }}
                                >
                                  Remove
                                </Button>
                              </InlineStack>
                            </InlineStack>
                          </Box>
                        ))}
                      </BlockStack>
                    )}

                    {!showAddMarketWindow && (
                      <InlineStack align="start">
                        <Button
                          onClick={() => {
                            setSelectedMarketId("");
                            setNewMarketWindowDays("30");
                            setShowAddMarketWindow(true);
                          }}
                        >
                          Add Market Window
                        </Button>
                      </InlineStack>
                    )}

                    {showAddMarketWindow && (
                      <Box
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                      >
                        <BlockStack gap="400">
                          <Select
                            label="Market"
                            options={[
                              { label: "Select a market", value: "" },
                              ...markets
                                .filter((m) => {
                                  // Show all markets when editing, otherwise filter out already configured ones
                                  if (selectedMarketId) return true;
                                  return !marketReturnWindows.some((mw) => mw.marketId === m.id);
                                })
                                .map((m) => ({ label: m.name, value: m.id })),
                            ]}
                            value={selectedMarketId}
                            onChange={setSelectedMarketId}
                            disabled={!!selectedMarketId && marketReturnWindows.some((mw) => mw.marketId === selectedMarketId)}
                          />
                          <TextField
                            label="Return Window (days)"
                            type="number"
                            value={newMarketWindowDays}
                            onChange={setNewMarketWindowDays}
                            min={1}
                            max={365}
                            autoComplete="off"
                          />
                          <InlineStack gap="200">
                            <Button
                              variant="primary"
                              onClick={() => {
                                if (!selectedMarketId) return;
                                const days = parseInt(newMarketWindowDays) || 30;
                                const marketName = markets.find((m) => m.id === selectedMarketId)?.name || "";

                                // Check if editing existing
                                const existingIndex = marketReturnWindows.findIndex((mw) => mw.marketId === selectedMarketId);
                                if (existingIndex >= 0) {
                                  // Update existing
                                  const updated = [...marketReturnWindows];
                                  updated[existingIndex] = { marketId: selectedMarketId, marketName, returnWindowDays: days };
                                  setMarketReturnWindows(updated);
                                } else {
                                  // Add new
                                  setMarketReturnWindows([...marketReturnWindows, { marketId: selectedMarketId, marketName, returnWindowDays: days }]);
                                }

                                setShowAddMarketWindow(false);
                                setSelectedMarketId("");
                                setNewMarketWindowDays("30");
                              }}
                              disabled={!selectedMarketId}
                            >
                              {marketReturnWindows.some((mw) => mw.marketId === selectedMarketId) ? "Update" : "Add"}
                            </Button>
                            <Button
                              onClick={() => {
                                setShowAddMarketWindow(false);
                                setSelectedMarketId("");
                                setNewMarketWindowDays("30");
                              }}
                            >
                              Cancel
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    )}

                    {marketReturnWindows.length === 0 && !showAddMarketWindow && (
                      <Box padding="400">
                        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                          No market-specific return windows configured. The default return window will apply to all markets.
                        </Text>
                      </Box>
                    )}
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>

              <Layout.AnnotatedSection
                title="Return Reasons"
                description="Manage the reasons customers can select when submitting a return or replacement."
              >
                <Card>
                  <BlockStack gap="300">
                    <Text as="p" variant="bodyMd">
                      Return and replacement reasons are now managed on the dedicated Reasons page.
                    </Text>
                    <InlineStack align="start">
                      <Button url="/app/reasons">
                        Manage Reasons
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>
            </Layout>
          )}

          {/* Tab 1: Branding */}
          {selectedTab === 1 && (
            <Layout>
              <Layout.AnnotatedSection
                title="Logo"
                description="Add your brand logo and choose its position in the portal header."
              >
                <Card>
                  <BlockStack gap="400">
                    <TextField
                      label="Logo URL"
                      value={logoUrl}
                      onChange={(value) => {
                        setLogoUrl(value);
                        setLogoError(false);
                      }}
                      autoComplete="off"
                      placeholder="https://cdn.shopify.com/s/files/your-logo.png"
                      helpText="Upload images to Shopify Files (Settings → Files) and paste the URL here. Recommended size: 200×60px."
                    />
                    {logoUrl && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="medium">Preview</Text>
                        <Box
                          background="bg-surface-secondary"
                          padding="400"
                          borderRadius="200"
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: portalLogoPosition === "center" ? "center" : "flex-start", minHeight: "60px" }}>
                            {logoError ? (
                              <span style={{ color: "#9CA3AF", fontSize: "14px" }}>Failed to load image — check the URL</span>
                            ) : (
                              <img
                                src={logoUrl}
                                alt="Brand logo preview"
                                style={{
                                  maxHeight: "60px",
                                  maxWidth: "250px",
                                  objectFit: "contain",
                                }}
                                onError={() => setLogoError(true)}
                              />
                            )}
                          </div>
                        </Box>
                        <InlineStack align="start">
                          <Button
                            variant="plain"
                            tone="critical"
                            onClick={() => setLogoUrl("")}
                          >
                            Remove logo
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    )}
                    <Select
                      label="Logo position"
                      options={[
                        { label: "Left", value: "left" },
                        { label: "Center", value: "center" },
                      ]}
                      value={portalLogoPosition}
                      onChange={setPortalLogoPosition}
                      helpText="Position of the logo (or store name) in the portal header."
                    />
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>

              <Layout.AnnotatedSection
                title="Colors"
                description="Customize the primary button and text colors used throughout the customer portal."
              >
                <Card>
                  <BlockStack gap="400">
                    <div>
                      <Text as="p" variant="bodySm" fontWeight="medium">Button color</Text>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
                        <input
                          type="color"
                          value={portalButtonColor}
                          onChange={(e) => setPortalButtonColor(e.target.value)}
                          style={{ width: "40px", height: "40px", border: "1px solid #d1d5db", borderRadius: "8px", padding: "2px", cursor: "pointer" }}
                        />
                        <TextField
                          label=""
                          labelHidden
                          value={portalButtonColor}
                          onChange={setPortalButtonColor}
                          autoComplete="off"
                          monospaced
                          placeholder="#0284c7"
                        />
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">Background color of the primary action button (submit, continue, etc.)</Text>
                    </div>

                    <div>
                      <Text as="p" variant="bodySm" fontWeight="medium">Button text color</Text>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
                        <input
                          type="color"
                          value={portalButtonTextColor}
                          onChange={(e) => setPortalButtonTextColor(e.target.value)}
                          style={{ width: "40px", height: "40px", border: "1px solid #d1d5db", borderRadius: "8px", padding: "2px", cursor: "pointer" }}
                        />
                        <TextField
                          label=""
                          labelHidden
                          value={portalButtonTextColor}
                          onChange={setPortalButtonTextColor}
                          autoComplete="off"
                          monospaced
                          placeholder="#ffffff"
                        />
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">Text color inside the primary button.</Text>
                    </div>

                    <div>
                      <Text as="p" variant="bodySm" fontWeight="medium">Body text color</Text>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
                        <input
                          type="color"
                          value={portalTextColor}
                          onChange={(e) => setPortalTextColor(e.target.value)}
                          style={{ width: "40px", height: "40px", border: "1px solid #d1d5db", borderRadius: "8px", padding: "2px", cursor: "pointer" }}
                        />
                        <TextField
                          label=""
                          labelHidden
                          value={portalTextColor}
                          onChange={setPortalTextColor}
                          autoComplete="off"
                          monospaced
                          placeholder="#374151"
                        />
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">Default text color for labels, descriptions, and body content.</Text>
                    </div>

                    {/* Live preview swatch */}
                    <Divider />
                    <Text as="p" variant="bodySm" fontWeight="medium">Preview</Text>
                    <Box
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <p style={{ color: portalTextColor, fontSize: "14px", margin: 0 }}>
                          This is how body text will look in the portal.
                        </p>
                        <div>
                          <button
                            type="button"
                            style={{
                              backgroundColor: portalButtonColor,
                              color: portalButtonTextColor,
                              padding: "10px 20px",
                              border: "none",
                              borderRadius: "10px",
                              fontWeight: 600,
                              fontSize: "14px",
                              cursor: "default",
                            }}
                          >
                            Submit Return Request
                          </button>
                        </div>
                      </div>
                    </Box>

                    <InlineStack align="start">
                      <Button
                        variant="plain"
                        onClick={() => {
                          setPortalButtonColor("#0284c7");
                          setPortalButtonTextColor("#ffffff");
                          setPortalTextColor("#374151");
                        }}
                      >
                        Reset to defaults
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>

              <Layout.AnnotatedSection
                title="Typography"
                description="Choose the font style for headings and body text in the customer portal."
              >
                <Card>
                  <BlockStack gap="400">
                    <Select
                      label="Heading font"
                      options={[
                        { label: "Sans-serif (default)", value: "sans-serif" },
                        { label: "Serif", value: "serif" },
                        { label: "Monospace", value: "mono" },
                      ]}
                      value={portalHeadingFont}
                      onChange={setPortalHeadingFont}
                      helpText="Font used for titles and section headings."
                    />
                    <Select
                      label="Body font"
                      options={[
                        { label: "Sans-serif (default)", value: "sans-serif" },
                        { label: "Serif", value: "serif" },
                        { label: "Monospace", value: "mono" },
                      ]}
                      value={portalBodyFont}
                      onChange={setPortalBodyFont}
                      helpText="Font used for labels, descriptions, and form fields."
                    />

                    {/* Typography preview */}
                    <Divider />
                    <Text as="p" variant="bodySm" fontWeight="medium">Preview</Text>
                    <Box
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <p style={{
                          fontFamily: portalHeadingFont === "serif" ? "Georgia, 'Times New Roman', serif" : portalHeadingFont === "mono" ? "'SF Mono', Consolas, monospace" : "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                          fontSize: "18px",
                          fontWeight: 600,
                          margin: 0,
                          color: "#111827",
                        }}>
                          Return Request for Order #1234
                        </p>
                        <p style={{
                          fontFamily: portalBodyFont === "serif" ? "Georgia, 'Times New Roman', serif" : portalBodyFont === "mono" ? "'SF Mono', Consolas, monospace" : "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                          fontSize: "14px",
                          margin: 0,
                          color: portalTextColor,
                        }}>
                          Select the items you would like to return and choose a reason.
                        </p>
                      </div>
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>
            </Layout>
          )}

          {/* Tab 2: Returns */}
          {selectedTab === 2 && (
            <Layout>
              <Layout.AnnotatedSection
                title="Return Instructions"
                description="Instructions shown to customers after their return is approved."
              >
                <Card>
                  <TextField
                    label="Return instructions"
                    value={returnInstructions}
                    onChange={setReturnInstructions}
                    multiline={4}
                    autoComplete="off"
                    helpText="Include details about how to ship items back, packaging requirements, etc."
                  />
                </Card>
              </Layout.AnnotatedSection>

              <Layout.AnnotatedSection
                title="Resolution Options"
                description="Configure which resolution types are available to customers."
              >
                <Card>
                  <BlockStack gap="400">
                    <Checkbox
                      label="Enable Replacement"
                      checked={enableReplacement}
                      onChange={setEnableReplacement}
                      helpText="Allow customers to request a replacement of the same item."
                    />

                    {!enableReplacement && (
                      <Banner tone="info">
                        <p>
                          Only refunds will be available to customers. Enable replacement to give customers more options.
                        </p>
                      </Banner>
                    )}
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>

              <Layout.AnnotatedSection
                title="Prescription Product Grouping"
                description="Group related line items (e.g., frame + lens) as a single returnable unit in the customer portal."
              >
                <Card>
                  <BlockStack gap="400">
                    <Checkbox
                      label="Enable RX product grouping"
                      checked={enableRxGrouping}
                      onChange={setEnableRxGrouping}
                      helpText="When enabled, line items sharing the same _itemsRelationshipId property will be grouped together and displayed as a single returnable item."
                    />
                    {enableRxGrouping && (
                      <Banner tone="info">
                        <p>
                          This feature works with <strong>RXAPP</strong> and <strong>Roxable</strong> products (prescription eyewear).
                          Line items that share the same <code>_itemsRelationshipId</code> custom attribute are treated as a single product
                          (e.g., frame + prescription lens). Only the frame will be shown as the selectable item in the return portal — the lens
                          will be automatically included in the return.
                        </p>
                      </Banner>
                    )}

                    {enableRxGrouping && enableReplacement && (
                      <>
                        <Divider />
                        <Checkbox
                          label="Exclude replacement for grouped prescription products"
                          checked={excludeReplacementForRxGroup}
                          onChange={setExcludeReplacementForRxGroup}
                          helpText="When enabled, grouped prescription products (frame + lens) will only be eligible for refund — replacement will not be offered. Customers will see a message explaining that replacement is not available for prescription products."
                        />
                        {excludeReplacementForRxGroup && (
                          <Banner tone="info">
                            <p>
                              Prescription product groups will only show <strong>Refund</strong> as a resolution option.
                              Customers will see a translatable message explaining that replacement is not available for these items.
                              You can customize this message in the <strong>Translations</strong> tab.
                            </p>
                          </Banner>
                        )}
                      </>
                    )}
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>

              <Layout.AnnotatedSection
                title="Serial Number Tracking"
                description="Enable serial number tracking for returned items. Requires ERP integration to populate serial numbers."
              >
                <Card>
                  <BlockStack gap="400">
                    <Checkbox
                      label="Enable serial number tracking"
                      checked={enableSerialNumbers}
                      onChange={setEnableSerialNumbers}
                      helpText="When enabled, customers must select specific serial numbers when creating a return. Serial numbers are synced from the Shopify order metafield (custom.serial_numbers) populated by your ERP integration."
                    />
                    {enableSerialNumbers && (
                      <Banner tone="info">
                        <p>
                          Serial number tracking requires an <strong>ERP integration</strong> to populate the{" "}
                          <code>custom.serial_numbers</code> metafield on fulfilled orders.
                          Each serial number represents one physical unit — customers will select specific units
                          to return instead of choosing quantities.
                        </p>
                      </Banner>
                    )}
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>
            </Layout>
          )}

          {/* Tab 3: Automation */}
          {selectedTab === 3 && (
            <Layout>
              <Layout.AnnotatedSection
                title="Automation"
                description="Configure automatic return processing."
              >
                <Card>
                  <BlockStack gap="300">
                    <Checkbox
                      label="Auto-approve return requests"
                      checked={autoApprove}
                      onChange={setAutoApprove}
                      helpText="When enabled, all return requests that pass eligibility checks will be automatically approved."
                    />
                    {autoApprove && (
                      <Banner tone="warning">
                        <p>
                          All eligible return requests will be automatically approved
                          without manual review. Make sure your return window and
                          eligibility settings are properly configured.
                        </p>
                      </Banner>
                    )}
                    <Checkbox
                      label="Auto-approve replacement requests"
                      checked={autoApproveReplacements}
                      onChange={setAutoApproveReplacements}
                      helpText="When enabled, replacement requests that pass eligibility checks will be automatically approved. Only applies when replacements are enabled."
                    />
                    {autoApproveReplacements && (
                      <Banner tone="warning">
                        <p>
                          All eligible replacement requests will be automatically approved
                          without manual review.
                        </p>
                      </Banner>
                    )}
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>
            </Layout>
          )}

          {/* Save button - show on all settings tabs (not Shipping, API keys, or Translations) */}
          {selectedTab !== 4 && selectedTab !== 5 && selectedTab !== 6 && (
            <Layout.Section>
              <div style={{ marginTop: "16px" }}>
                <InlineStack align="end">
                  <Button
                    submit
                    variant="primary"
                    loading={isSaving}
                    disabled={!hasChanges || isSaving}
                  >
                    Save Settings
                  </Button>
                </InlineStack>
              </div>
            </Layout.Section>
          )}
        </Form>

        {/* Tab 4: Shipping & Routing */}
        {selectedTab === 4 && (
          <Layout>
            {/* Shipping fetcher error/success banner */}
            {shippingFetcher.data && (shippingFetcher.data as any).error && !shippingBannerDismissed && (
              <Layout.Section>
                <Banner tone="critical" onDismiss={() => setShippingBannerDismissed(true)}>
                  <p>{(shippingFetcher.data as any).error}</p>
                </Banner>
              </Layout.Section>
            )}
            {shippingFetcher.data && (shippingFetcher.data as any).success && !shippingBannerDismissed && (
              <Layout.Section>
                <Banner tone="success" onDismiss={() => setShippingBannerDismissed(true)}>
                  <p>
                    {(shippingFetcher.data as any).intent === "test-shipping-connection"
                      ? `Connection test passed. ${(shippingFetcher.data as any).connectionTest?.message || ""}`
                      : (shippingFetcher.data as any).connectionTest
                        ? `Saved and connected. ${(shippingFetcher.data as any).connectionTest.message}`
                        : "Changes saved successfully."}
                  </p>
                </Banner>
              </Layout.Section>
            )}

            <Layout.AnnotatedSection
              title="Shipping Provider"
              description="Configure ProcessWeaver to generate real carrier shipping labels. When configured, labels will be generated via ProcessWeaver instead of mock labels."
            >
              <Card>
                <BlockStack gap="400">
                  {shippingProvider ? (
                    <>
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">ProcessWeaver</Text>
                            <Badge tone={shippingProvider.active ? "success" : "critical"}>
                              {shippingProvider.active ? "Connected" : "Connection Failed"}
                            </Badge>
                            <Badge>{shippingProvider.environment}</Badge>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            API Key: {shippingProvider.apiKey.substring(0, 8)}...
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Carrier accounts: {carrierAccounts.length}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button
                            size="slim" variant="plain"
                            loading={shippingFetcher.state !== "idle" && shippingFetcher.formData?.get("intent") === "test-shipping-connection"}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "test-shipping-connection");
                              shippingFetcher.submit(fd, { method: "post" });
                            }}
                          >Test Connection</Button>
                          <Button size="slim" onClick={() => {
                            setProviderApiKey(shippingProvider.apiKey);
                            setProviderEnvironment(shippingProvider.environment);
                            setProviderShipEndpoint(shippingProvider.shipEndpoint);
                            setProviderTrackEndpoint(shippingProvider.trackEndpoint);
                            setShowProviderForm(true);
                          }}>Edit</Button>
                          <Button
                            size="slim" tone="critical" variant="plain"
                            loading={shippingFetcher.state !== "idle" && shippingFetcher.formData?.get("intent") === "delete-shipping-provider"}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "delete-shipping-provider");
                              shippingFetcher.submit(fd, { method: "post" });
                            }}
                          >Disconnect</Button>
                        </InlineStack>
                      </InlineStack>
                      {!shippingProvider.active && (
                        <Banner tone="warning">
                          <p>Connection test failed. The ProcessWeaver endpoint may be unreachable or the API key may be invalid. Check your endpoint URL and API key, then click "Test Connection" to retry.</p>
                        </Banner>
                      )}
                    </>
                  ) : !showProviderForm ? (
                    <BlockStack gap="300">
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        No shipping provider configured. Connect ProcessWeaver to generate real carrier labels.
                      </Text>
                      <InlineStack align="center">
                        <Button onClick={() => setShowProviderForm(true)}>Connect ProcessWeaver</Button>
                      </InlineStack>
                    </BlockStack>
                  ) : null}

                  {showProviderForm && (
                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                          {shippingProvider ? "Edit ProcessWeaver Connection" : "Connect ProcessWeaver"}
                        </Text>
                        <TextField
                          label="API Key"
                          value={providerApiKey}
                          onChange={setProviderApiKey}
                          autoComplete="off"
                          placeholder="Your ProcessWeaver API key"
                          helpText="Contact ProcessWeaver for test or production API keys."
                          type="password"
                        />
                        <Select
                          label="Environment"
                          options={[
                            { label: "Test", value: "TEST" },
                            { label: "Production", value: "PROD" },
                          ]}
                          value={providerEnvironment}
                          onChange={setProviderEnvironment}
                          helpText="Use Test for development, switch to Production when ready."
                        />
                        <TextField
                          label="Ship API Endpoint"
                          value={providerShipEndpoint}
                          onChange={setProviderShipEndpoint}
                          autoComplete="off"
                          helpText="Default endpoint works for most setups. Only change if ProcessWeaver provides a custom URL."
                        />
                        <TextField
                          label="Track API Endpoint"
                          value={providerTrackEndpoint}
                          onChange={setProviderTrackEndpoint}
                          autoComplete="off"
                        />
                        <InlineStack gap="200">
                          <Button
                            variant="primary"
                            loading={shippingFetcher.state !== "idle"}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "save-shipping-provider");
                              fd.append("providerApiKey", providerApiKey);
                              fd.append("providerEnvironment", providerEnvironment);
                              fd.append("providerShipEndpoint", providerShipEndpoint);
                              fd.append("providerTrackEndpoint", providerTrackEndpoint);
                              shippingFetcher.submit(fd, { method: "post" });
                            }}
                            disabled={!providerApiKey}
                          >
                            {shippingProvider ? "Save & Test Connection" : "Connect & Test"}
                          </Button>
                          <Button onClick={() => setShowProviderForm(false)}>Cancel</Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            {shippingProvider && (
              <Layout.AnnotatedSection
                title="Carrier Accounts"
                description="Add your carrier credentials (FedEx, UPS, DHL, CanadaPost, etc.). Each carrier account stores the credentials ProcessWeaver needs to generate labels with that carrier."
              >
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">Your Carrier Accounts</Text>
                      {!showCarrierForm && (
                        <Button onClick={() => { resetCarrierForm(); setShowCarrierForm(true); }}>
                          Add Carrier Account
                        </Button>
                      )}
                    </InlineStack>

                    {carrierAccounts.length === 0 && !showCarrierForm && (
                      <Box padding="400">
                        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                          No carrier accounts configured. Add a carrier to start generating real shipping labels.
                        </Text>
                      </Box>
                    )}

                    {carrierAccounts.map((ca: any) => (
                      <Box key={ca.id} background="bg-surface-secondary" padding="300" borderRadius="200">
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">{ca.name}</Text>
                              <Badge>{ca.carrierCode}</Badge>
                              {!ca.active && <Badge tone="critical">Inactive</Badge>}
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="subdued">
                              Account: {ca.accountNumber}
                              {ca.serviceType ? ` | Service: ${ca.serviceType}` : ""}
                              {ca.paymentType ? ` | Payment: ${ca.paymentType}` : ""}
                              {ca.labelFormat ? ` | Format: ${ca.labelFormat}` : ""}
                            </Text>
                          </BlockStack>
                          <InlineStack gap="200">
                            <Button size="slim" onClick={() => editCarrier(ca)}>Edit</Button>
                            <Button
                              size="slim" tone="critical" variant="plain"
                              loading={shippingFetcher.state !== "idle" && (shippingFetcher.formData?.get("carrierId") === ca.id && shippingFetcher.formData?.get("intent") === "delete-carrier-account")}
                              onClick={() => {
                                const fd = new FormData();
                                fd.append("intent", "delete-carrier-account");
                                fd.append("carrierId", ca.id);
                                shippingFetcher.submit(fd, { method: "post" });
                              }}
                            >Delete</Button>
                          </InlineStack>
                        </InlineStack>
                      </Box>
                    ))}

                    {showCarrierForm && (
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">{editingCarrier ? "Edit Carrier Account" : "Add Carrier Account"}</Text>
                          <TextField label="Display Name" value={caName} onChange={setCaName} autoComplete="off" placeholder="e.g. FedEx US Returns, CanadaPost, UPS Italy" />
                          <Select
                            label="Carrier"
                            options={[
                              { label: "Select a carrier...", value: "" },
                              { label: "FedEx", value: "FEDEX" },
                              { label: "UPS", value: "UPS" },
                              { label: "DHL", value: "DHL" },
                              { label: "DHL Express", value: "DHLEXPRESS" },
                              { label: "Canada Post", value: "CANADAPOST" },
                              { label: "Australia Post", value: "AUSPOST" },
                              { label: "NZ Post", value: "NZPOST" },
                              { label: "USPS", value: "USPS" },
                              { label: "Purolator", value: "PUROLATOR" },
                              { label: "TNT", value: "TNT" },
                            ]}
                            value={caCarrierCode}
                            onChange={setCaCarrierCode}
                          />
                          <TextField label="Account Number" value={caAccountNumber} onChange={setCaAccountNumber} autoComplete="off" helpText="Your carrier account number." />
                          <InlineStack gap="300">
                            <div style={{ flex: 1 }}><TextField label="User ID" value={caUserId} onChange={setCaUserId} autoComplete="off" /></div>
                            <div style={{ flex: 1 }}><TextField label="Password" value={caPassword} onChange={setCaPassword} autoComplete="off" type="password" /></div>
                          </InlineStack>
                          <InlineStack gap="300">
                            <div style={{ flex: 1 }}><TextField label="Meter Number" value={caMeterNumber} onChange={setCaMeterNumber} autoComplete="off" helpText="Required by some carriers (e.g., FedEx, NZ Post)." /></div>
                            <div style={{ flex: 1 }}><TextField label="Service Type" value={caServiceType} onChange={setCaServiceType} autoComplete="off" placeholder="e.g. PRIORITY_OVERNIGHT, XP, 11" helpText="The carrier's service code for returns." /></div>
                          </InlineStack>
                          <InlineStack gap="300">
                            <div style={{ flex: 1 }}>
                              <Select
                                label="Payment Type"
                                options={[
                                  { label: "Sender", value: "SENDER" },
                                  { label: "Recipient", value: "RECIPIENT" },
                                ]}
                                value={caPaymentType}
                                onChange={setCaPaymentType}
                                helpText="Who pays for the shipment."
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <Select
                                label="Date Format"
                                options={[
                                  { label: "yyyy-MM-dd (Default)", value: "yyyy-MM-dd" },
                                  { label: "MM-dd-yyyy", value: "MM-dd-yyyy" },
                                  { label: "dd-MM-yyyy", value: "dd-MM-yyyy" },
                                ]}
                                value={caShipDateFormat}
                                onChange={setCaShipDateFormat}
                                helpText="Date format the carrier expects."
                              />
                            </div>
                          </InlineStack>
                          <Select
                            label="Label Format"
                            options={[
                              { label: "PNG", value: "PNG" },
                              { label: "PDF", value: "PDF" },
                              { label: "ZPL (Thermal Printer)", value: "ZPL" },
                            ]}
                            value={caLabelFormat}
                            onChange={setCaLabelFormat}
                            helpText="Label image format for this carrier."
                          />
                          <InlineStack gap="200">
                            <Button
                              variant="primary"
                              loading={shippingFetcher.state !== "idle"}
                              onClick={() => {
                                const fd = new FormData();
                                fd.append("intent", editingCarrier ? "update-carrier-account" : "create-carrier-account");
                                if (editingCarrier) fd.append("carrierId", editingCarrier);
                                fd.append("carrierName", caName);
                                fd.append("carrierCode", caCarrierCode);
                                fd.append("carrierAccountNumber", caAccountNumber);
                                fd.append("carrierUserId", caUserId);
                                fd.append("carrierPassword", caPassword);
                                fd.append("carrierMeterNumber", caMeterNumber);
                                fd.append("carrierServiceType", caServiceType);
                                fd.append("carrierPaymentType", caPaymentType);
                                fd.append("carrierShipDateFormat", caShipDateFormat);
                                fd.append("carrierLabelFormat", caLabelFormat);
                                shippingFetcher.submit(fd, { method: "post" });
                              }}
                              disabled={!caName || !caCarrierCode || !caAccountNumber}
                            >
                              {editingCarrier ? "Update Carrier" : "Add Carrier"}
                            </Button>
                            <Button onClick={resetCarrierForm}>Cancel</Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    )}
                  </BlockStack>
                </Card>
              </Layout.AnnotatedSection>
            )}

            <Layout.AnnotatedSection
              title="Warehouses"
              description="Configure your return warehouse addresses. These are the locations customers will ship items back to."
            >
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">Your Warehouses</Text>
                    {!showWarehouseForm && (
                      <Button onClick={() => { resetWarehouseForm(); setShowWarehouseForm(true); }}>
                        Add Warehouse
                      </Button>
                    )}
                  </InlineStack>

                  {/* Warehouse list */}
                  {warehouses.length === 0 && !showWarehouseForm && (
                    <Box padding="400">
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        No warehouses configured. Add a warehouse to enable return shipping.
                      </Text>
                    </Box>
                  )}

                  {warehouses.map((wh) => (
                    <Box key={wh.id} background="bg-surface-secondary" padding="300" borderRadius="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">{wh.name}</Text>
                            {wh.isDefault && <Badge tone="info">Default</Badge>}
                            {!wh.active && <Badge>Inactive</Badge>}
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {wh.address1}{wh.address2 ? `, ${wh.address2}` : ""} — {wh.zip} {wh.city}{wh.province ? `, ${wh.province}` : ""}, {wh.country}
                          </Text>
                          {wh.phone && <Text as="span" variant="bodySm" tone="subdued">Tel: {wh.phone}</Text>}
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => editWarehouse(wh)}>Edit</Button>
                          <Button
                            size="slim" tone="critical" variant="plain"
                            loading={shippingFetcher.state !== "idle" && (shippingFetcher.formData?.get("warehouseId") === wh.id && shippingFetcher.formData?.get("intent") === "delete-warehouse")}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "delete-warehouse");
                              fd.append("warehouseId", wh.id);
                              shippingFetcher.submit(fd, { method: "post" });
                            }}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </Box>
                  ))}

                  {/* Warehouse form (create/edit) */}
                  {showWarehouseForm && (
                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">{editingWarehouse ? "Edit Warehouse" : "Add Warehouse"}</Text>
                        <TextField label="Name" value={whName} onChange={setWhName} autoComplete="off" placeholder="e.g. EU Returns Center" />
                        <TextField label="Address Line 1" value={whAddress1} onChange={setWhAddress1} autoComplete="off" />
                        <TextField label="Address Line 2" value={whAddress2} onChange={setWhAddress2} autoComplete="off" />
                        <InlineStack gap="300">
                          <div style={{ flex: 1 }}><TextField label="City" value={whCity} onChange={setWhCity} autoComplete="off" /></div>
                          <div style={{ flex: 1 }}><TextField label="Province/State" value={whProvince} onChange={setWhProvince} autoComplete="off" /></div>
                        </InlineStack>
                        <InlineStack gap="300">
                          <div style={{ flex: 1 }}><TextField label="ZIP/Postal Code" value={whZip} onChange={setWhZip} autoComplete="off" /></div>
                          <div style={{ flex: 1 }}><TextField label="Country" value={whCountry} onChange={setWhCountry} autoComplete="off" placeholder="e.g. Italy" /></div>
                        </InlineStack>
                        <InlineStack gap="300">
                          <div style={{ flex: 1 }}><TextField label="Phone" value={whPhone} onChange={setWhPhone} autoComplete="off" /></div>
                          <div style={{ flex: 1 }}><TextField label="Email" value={whEmail} onChange={setWhEmail} autoComplete="off" /></div>
                        </InlineStack>
                        <Checkbox label="Set as default warehouse" checked={whIsDefault} onChange={setWhIsDefault} />
                        <InlineStack gap="200">
                          <Button
                            variant="primary"
                            loading={shippingFetcher.state !== "idle"}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", editingWarehouse ? "update-warehouse" : "create-warehouse");
                              if (editingWarehouse) fd.append("warehouseId", editingWarehouse);
                              fd.append("warehouseName", whName);
                              fd.append("warehouseAddress1", whAddress1);
                              fd.append("warehouseAddress2", whAddress2);
                              fd.append("warehouseCity", whCity);
                              fd.append("warehouseProvince", whProvince);
                              fd.append("warehouseZip", whZip);
                              fd.append("warehouseCountry", whCountry);
                              fd.append("warehouseCountryCode", whCountryCode);
                              fd.append("warehousePhone", whPhone);
                              fd.append("warehouseEmail", whEmail);
                              fd.append("warehouseIsDefault", String(whIsDefault));
                              shippingFetcher.submit(fd, { method: "post" });
                            }}
                            disabled={!whName || !whAddress1 || !whCity || !whZip || !whCountry}
                          >
                            {editingWarehouse ? "Update Warehouse" : "Add Warehouse"}
                          </Button>
                          <Button onClick={resetWarehouseForm}>Cancel</Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Routing Rules"
              description="Configure which warehouse customers ship to based on their market. You can also set per-market return instructions and shipping method."
            >
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">Your Routing Rules</Text>
                    {!showRoutingForm && warehouses.length > 0 && (
                      <Button onClick={() => { resetRoutingForm(); setShowRoutingForm(true); }}>
                        Add Routing Rule
                      </Button>
                    )}
                  </InlineStack>

                  {warehouses.length === 0 && (
                    <Banner tone="info">
                      <p>Add a warehouse first before creating routing rules.</p>
                    </Banner>
                  )}

                  {/* Routing rules list */}
                  {routingRules.length === 0 && warehouses.length > 0 && !showRoutingForm && (
                    <Box padding="400">
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        No routing rules configured. All returns will use the default warehouse.
                      </Text>
                    </Box>
                  )}

                  {routingRules.map((rule) => (
                    <Box key={rule.id} background="bg-surface-secondary" padding="300" borderRadius="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {rule.marketName || "Default (All Markets)"}
                            </Text>
                            {!rule.active && <Badge tone="critical">Inactive</Badge>}
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Warehouse: {rule.warehouse.name}
                          </Text>
                          {rule.carrierAccount ? (
                            <Text as="span" variant="bodySm" tone="subdued">
                              Carrier: {rule.carrierAccount.name} ({rule.carrierAccount.carrierCode})
                            </Text>
                          ) : (
                            <Text as="span" variant="bodySm" tone="subdued">
                              Carrier: Not assigned
                            </Text>
                          )}
                          {rule.returnInstructions && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              Instructions: {rule.returnInstructions.substring(0, 80)}{rule.returnInstructions.length > 80 ? "..." : ""}
                            </Text>
                          )}
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => editRule(rule)}>Edit</Button>
                          <Button
                            size="slim" tone="critical" variant="plain"
                            loading={shippingFetcher.state !== "idle" && (shippingFetcher.formData?.get("ruleId") === rule.id && shippingFetcher.formData?.get("intent") === "delete-routing-rule")}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "delete-routing-rule");
                              fd.append("ruleId", rule.id);
                              shippingFetcher.submit(fd, { method: "post" });
                            }}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </Box>
                  ))}

                  {/* Routing rule form (create/edit) */}
                  {showRoutingForm && (
                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">{editingRule ? "Edit Routing Rule" : "Add Routing Rule"}</Text>
                        <Select
                          label="Market"
                          options={[
                            { label: "Default (All Markets)", value: "" },
                            ...markets.map((m) => ({ label: m.name, value: m.id })),
                          ]}
                          value={ruleMarketId}
                          onChange={setRuleMarketId}
                          helpText="Leave as 'Default' to apply to all markets without a specific rule."
                        />
                        <Select
                          label="Warehouse"
                          options={[
                            { label: "Select a warehouse", value: "" },
                            ...warehouses.filter((w) => w.active || (editingRule && ruleWarehouseId === w.id)).map((w) => ({ label: `${w.name} (${w.city}, ${w.country})${!w.active ? " - Inactive" : ""}`, value: w.id })),
                          ]}
                          value={ruleWarehouseId}
                          onChange={setRuleWarehouseId}
                        />
                        {carrierAccounts.length > 0 && (
                          <Select
                            label="Carrier Account"
                            options={[
                              { label: "No carrier account", value: "" },
                              ...carrierAccounts.filter((ca: any) => ca.active).map((ca: any) => ({
                                label: `${ca.name} (${ca.carrierCode})`,
                                value: ca.id,
                              })),
                            ]}
                            value={ruleCarrierAccountId}
                            onChange={setRuleCarrierAccountId}
                            helpText="Select the ProcessWeaver carrier account to use for label generation on this route."
                          />
                        )}
                        <TextField
                          label="Return Instructions"
                          value={ruleReturnInstructions}
                          onChange={setRuleReturnInstructions}
                          multiline={3}
                          autoComplete="off"
                          helpText="Specific instructions shown to customers in this market when returning items."
                          placeholder="e.g. Please ship items to our EU warehouse via the provided return label..."
                        />
                        <InlineStack gap="200">
                          <Button
                            variant="primary"
                            loading={shippingFetcher.state !== "idle"}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", editingRule ? "update-routing-rule" : "create-routing-rule");
                              if (editingRule) fd.append("ruleId", editingRule);
                              fd.append("ruleMarketId", ruleMarketId);
                              fd.append("ruleMarketName", ruleMarketId ? (markets.find((m) => m.id === ruleMarketId)?.name || "") : "");
                              fd.append("ruleWarehouseId", ruleWarehouseId);
                              fd.append("ruleReturnInstructions", ruleReturnInstructions);
                              fd.append("ruleCarrierAccountId", ruleCarrierAccountId);
                              shippingFetcher.submit(fd, { method: "post" });
                            }}
                            disabled={!ruleWarehouseId}
                          >
                            {editingRule ? "Update Rule" : "Add Rule"}
                          </Button>
                          <Button onClick={resetRoutingForm}>Cancel</Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          </Layout>
        )}

        {/* Tab 5: API Keys */}
        {selectedTab === 5 && (
          <Layout>
            <Layout.AnnotatedSection
              title="API Keys"
              description="Create API keys for external integrations. API keys provide programmatic access to manage returns."
            >
              <Card>
                <BlockStack gap="400">
                  {/* New key created banner */}
                  {newApiKey && (
                    <Banner tone="warning" onDismiss={() => setNewApiKey(null)}>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd" fontWeight="bold">
                          API key created — copy it now, it won't be shown again:
                        </Text>
                        <Box background="bg-surface-secondary" padding="200" borderRadius="100">
                          <InlineStack gap="200" blockAlign="center" align="space-between">
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              <code>{newApiKey}</code>
                            </Text>
                            <Button
                              size="slim"
                              onClick={async () => {
                                // Bug #211 Fix - Add error handling for clipboard copy
                                try {
                                  await navigator.clipboard.writeText(newApiKey);
                                  setCopiedApiKey(true);
                                  if (copyApiKeyTimeoutRef.current) clearTimeout(copyApiKeyTimeoutRef.current);
                                  copyApiKeyTimeoutRef.current = setTimeout(() => setCopiedApiKey(false), 2000);
                                } catch {
                                  // Silent fail - user can still manually copy the visible key
                                }
                              }}
                            >
                              {copiedApiKey ? "Copied!" : "Copy"}
                            </Button>
                          </InlineStack>
                        </Box>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Use this key in the Authorization header: Bearer {newApiKey.substring(0, 20)}...
                        </Text>
                      </BlockStack>
                    </Banner>
                  )}

                  {/* Create key button */}
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">Your API Keys</Text>
                    <Button onClick={() => { setNewKeyName(""); setCreateKeyModalOpen(true); }}>
                      Create API Key
                    </Button>
                  </InlineStack>

                  {/* Keys list */}
                  {apiKeys.length === 0 ? (
                    <Box padding="400">
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        No API keys yet. Create one to get started with the API.
                      </Text>
                    </Box>
                  ) : (
                    <BlockStack gap="300">
                      {apiKeys.map((key) => (
                        <Box
                          key={key.id}
                          background="bg-surface-secondary"
                          padding="300"
                          borderRadius="200"
                        >
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodyMd" fontWeight="semibold">
                                  {key.name}
                                </Text>
                                <Badge tone={key.active ? "success" : undefined}>
                                  {key.active ? "Active" : "Revoked"}
                                </Badge>
                              </InlineStack>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {key.prefix}... &middot; Created {new Date(key.createdAt).toLocaleDateString()}
                                {key.lastUsedAt && ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                              </Text>
                            </BlockStack>
                            <InlineStack gap="200">
                              {key.active && (
                                <Button
                                  size="slim"
                                  tone="critical"
                                  variant="plain"
                                  loading={actingOnKeyId === key.id && keyFetcher.state !== "idle"}
                                  onClick={() => {
                                    setActingOnKeyId(key.id);
                                    const formData = new FormData();
                                    formData.append("intent", "revoke-api-key");
                                    formData.append("keyId", key.id);
                                    keyFetcher.submit(formData, { method: "post" });
                                  }}
                                >
                                  Revoke
                                </Button>
                              )}
                              {!key.active && (
                                <Button
                                  size="slim"
                                  tone="critical"
                                  variant="plain"
                                  loading={actingOnKeyId === key.id && keyFetcher.state !== "idle"}
                                  onClick={() => {
                                    setActingOnKeyId(key.id);
                                    const formData = new FormData();
                                    formData.append("intent", "delete-api-key");
                                    formData.append("keyId", key.id);
                                    keyFetcher.submit(formData, { method: "post" });
                                  }}
                                >
                                  Delete
                                </Button>
                              )}
                            </InlineStack>
                          </InlineStack>
                        </Box>
                      ))}
                    </BlockStack>
                  )}

                  <Divider />
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">API Documentation</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Complete reference for all API endpoints, authentication, and examples.
                    </Text>
                    <div style={{ marginTop: "8px" }}>
                      <Button url="/app/api-docs" variant="plain">View API Documentation →</Button>
                    </div>
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          </Layout>
        )}

        {/* Tab 6: Translations */}
        {selectedTab === 6 && <TranslationsTab portalTranslations={portalTranslations} supportedLocales={supportedLocales} allReasons={allReasons} />}

        {/* Tab 7: Webhooks */}
        {selectedTab === 7 && (
          <Layout>
            <Layout.AnnotatedSection
              title="Outbound Webhooks"
              description="Send real-time notifications to external systems when return events occur."
            >
              <Card>
                <BlockStack gap="400">
                  <Checkbox
                    label="Enable webhooks"
                    checked={webhookActive}
                    onChange={setWebhookActive}
                    helpText="When enabled, the system will send HTTP POST notifications to the configured URL for all return events."
                  />
                  <TextField
                    label="Webhook URL"
                    value={webhookUrl}
                    onChange={setWebhookUrl}
                    placeholder="https://example.com/webhooks/returns"
                    helpText="The endpoint that will receive webhook notifications. Must be HTTPS."
                    autoComplete="off"
                    disabled={!webhookActive}
                  />
                  <TextField
                    label="Webhook Secret"
                    value={webhookSecret}
                    onChange={setWebhookSecret}
                    placeholder="Enter a secret key for HMAC-SHA256 signing"
                    helpText="Used to sign webhook payloads with HMAC-SHA256. The Base64-encoded signature is sent in the X-Webhook-Signature header (no prefix), matching the Shopify webhook convention."
                    autoComplete="off"
                    disabled={!webhookActive}
                  />
                  {webhookActive && (
                    <BlockStack gap="200">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">Webhook Events</Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Select which events trigger webhook notifications. Uncheck events you don't need.
                      </Text>
                      {ALL_WEBHOOK_EVENTS.map(evt => (
                        <div key={evt.value}>
                          <Checkbox
                            label={`${evt.label} (${evt.value})`}
                            checked={webhookEvents.includes(evt.value)}
                            onChange={() => toggleWebhookEvent(evt.value)}
                          />
                          {evt.value === "return.status_changed" && webhookEvents.includes("return.status_changed") && (
                            <Box paddingInlineStart="800" paddingBlockStart="200" paddingBlockEnd="100">
                              <BlockStack gap="100">
                                <Text as="span" variant="bodySm" tone="subdued">
                                  Fire only for these statuses {webhookStatusFilters.length === 0 ? "(all)" : `(${webhookStatusFilters.length} selected)`}:
                                </Text>
                                {ALL_RETURN_STATUSES.map(st => (
                                  <Checkbox
                                    key={st.value}
                                    label={st.label}
                                    checked={webhookStatusFilters.includes(st.value)}
                                    onChange={() => toggleStatusFilter(st.value)}
                                  />
                                ))}
                                {webhookStatusFilters.length === 0 && (
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    No filter applied — fires for all status transitions.
                                  </Text>
                                )}
                              </BlockStack>
                            </Box>
                          )}
                        </div>
                      ))}
                      {webhookEvents.length === 0 && (
                        <Banner tone="warning">
                          <p>No events selected. Webhooks will not fire until at least one event is enabled.</p>
                        </Banner>
                      )}
                    </BlockStack>
                  )}
                  {webhookActive && webhookUrl && (
                    <InlineStack align="start">
                      <Button
                        onClick={() => {
                          const fd = new FormData();
                          fd.append("intent", "test-webhook");
                          fd.append("testWebhookUrl", webhookUrl);
                          // Send the plaintext secret from local state so the test signs the
                          // request the same way a real delivery would, even before saving.
                          // If empty, the server falls back to the persisted, encrypted secret.
                          if (webhookSecret) {
                            fd.append("testWebhookSecret", webhookSecret);
                          }
                          webhookFetcher.submit(fd, { method: "post" });
                        }}
                        loading={webhookFetcher.state !== "idle"}
                      >
                        Send Test Webhook
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          </Layout>
        )}

        {/* Tab 8: Refund Authorization */}
        {selectedTab === 8 && (
          <div style={{ marginTop: "16px" }}>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Email verification (OTP)</Text>
                  <Checkbox
                    label="Require email OTP verification before processing refunds"
                    checked={requireRefundOtp}
                    onChange={setRequireRefundOtp}
                    helpText={
                      requireRefundOtp
                        ? "Authorized agents must enter a 6-digit code emailed to them before they can issue a refund."
                        : "OTP is disabled. Any admin user can process refunds without an extra verification step. The refund agent list is ignored."
                    }
                  />
                  {!requireRefundOtp && (
                    <Banner tone="warning">
                      <p>
                        OTP verification is off. Refunds will be processed immediately on click,
                        without a second-factor check. Re-enable this if you want to require
                        email verification.
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Refund Authorization</Text>
                  <Text as="p" variant="bodyMd">
                    Manage which team members can process refunds. When OTP is enabled,
                    authorized agents must verify their identity via email before processing
                    any refund.
                  </Text>
                  <InlineStack align="start">
                    <Button url="/app/settings/refund-agents" disabled={!requireRefundOtp}>
                      Manage Refund Agents
                    </Button>
                  </InlineStack>
                  {!requireRefundOtp && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      The agent list is unused while OTP is disabled.
                    </Text>
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          </div>
        )}
      </Tabs>

      {/* Create API Key Modal stays outside tabs */}
      <Modal
        open={createKeyModalOpen}
        onClose={() => {
          setCreateKeyModalOpen(false);
          setKeyError("");
        }}
        title="Create API Key"
        primaryAction={{
          content: "Create",
          loading: keyFetcher.state !== "idle",
          onAction: () => {
            const form = document.getElementById("create-key-form") as HTMLFormElement;
            form?.requestSubmit();
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => {
            setCreateKeyModalOpen(false);
            setKeyError("");
          } },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {keyError && (
              <Banner tone="critical">
                <p>{keyError}</p>
              </Banner>
            )}
            <keyFetcher.Form method="post" id="create-key-form">
              <input type="hidden" name="intent" value="create-api-key" />
              <TextField
                label="Key name"
                name="keyName"
                value={newKeyName}
                onChange={setNewKeyName}
                autoComplete="off"
                placeholder="e.g. ERP Integration, Warehouse System"
                helpText="A descriptive name to identify this API key."
              />
            </keyFetcher.Form>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status}: ${error.data}`
    : error instanceof Error
      ? error.message
      : "Unknown error";

  return (
    <Page title="Settings">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Something went wrong</Text>
              <Banner tone="critical">
                <p>{message}</p>
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
