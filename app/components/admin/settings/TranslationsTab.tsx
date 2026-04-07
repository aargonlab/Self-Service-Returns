import { useState, useEffect, useMemo } from "react";
import { useFetcher } from "@remix-run/react";
import {
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
  Select,
} from "@shopify/polaris";

type PortalTranslation = {
  id: string;
  locale: string;
  messages: any;
  isDefault: boolean;
  active: boolean;
};

type SupportedLocale = {
  code: string;
  name: string;
  nativeName: string;
};

type CustomReason = {
  id: string;
  code: string;
  label: string;
  active: boolean;
};

interface TranslationsTabProps {
  portalTranslations: PortalTranslation[];
  supportedLocales: SupportedLocale[];
  allReasons: CustomReason[];
}

export function TranslationsTab({ portalTranslations, supportedLocales, allReasons }: TranslationsTabProps) {
  const translationFetcher = useFetcher();
  const [selectedLocaleForEdit, setSelectedLocaleForEdit] = useState<string>("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [translationBannerDismissed, setTranslationBannerDismissed] = useState(false);

  const [staticTranslations, setStaticTranslations] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => {
    import("~/utils/portalTranslations").then((module) => {
      setStaticTranslations(module.translations);
    });
  }, []);

  const activeLocales = useMemo(() => {
    return portalTranslations.filter((t) => t.active).map((t) => t.locale);
  }, [portalTranslations]);

  const defaultLocale = useMemo(() => {
    return portalTranslations.find((t) => t.isDefault)?.locale || "en";
  }, [portalTranslations]);

  const translationKeyGroups = useMemo(() => {
    if (!staticTranslations.en) return {};
    const keys = Object.keys(staticTranslations.en);
    const groups: Record<string, string[]> = {
      "Layout": [],
      "Order Lookup": [],
      "Order Hub": [],
      "New Return": [],
      "Status": [],
      "Status Labels": [],
      "Reasons": [],
      "Errors": [],
    };

    keys.forEach((key) => {
      if (key.startsWith("portal.layout.")) groups["Layout"].push(key);
      else if (key.startsWith("portal.lookup.")) groups["Order Lookup"].push(key);
      else if (key.startsWith("portal.order.")) groups["Order Hub"].push(key);
      else if (key.startsWith("portal.new.")) groups["New Return"].push(key);
      else if (key.startsWith("portal.status.msg.")) groups["Status"].push(key);
      else if (key.startsWith("portal.statusLabel.")) groups["Status Labels"].push(key);
      else if (key.startsWith("portal.reason.")) groups["Reasons"].push(key);
      else if (key.startsWith("portal.error.")) groups["Errors"].push(key);
      else if (key.startsWith("portal.status.")) groups["Status"].push(key);
    });

    allReasons.forEach((reason) => {
      const key = `portal.reason.${reason.id}`;
      if (!groups["Reasons"].includes(key)) {
        groups["Reasons"].push(key);
      }
    });

    return groups;
  }, [staticTranslations, allReasons]);

  const currentOverrides = useMemo(() => {
    if (!selectedLocaleForEdit) return {};
    const translation = portalTranslations.find((t) => t.locale === selectedLocaleForEdit);
    return (translation?.messages as Record<string, string>) || {};
  }, [portalTranslations, selectedLocaleForEdit]);

  useEffect(() => {
    if (translationFetcher.state === "idle" && translationFetcher.data) {
      setTranslationBannerDismissed(false);
    }
  }, [translationFetcher.state, translationFetcher.data]);

  const handleToggleLocale = (locale: string, currentlyActive: boolean) => {
    const fd = new FormData();
    if (currentlyActive) {
      fd.append("intent", "toggle-locale");
      fd.append("locale", locale);
      fd.append("active", "false");
    } else {
      fd.append("intent", "activate-locale");
      fd.append("locale", locale);
    }
    translationFetcher.submit(fd, { method: "post" });
  };

  const handleSetDefault = (locale: string) => {
    const fd = new FormData();
    fd.append("intent", "set-default-locale");
    fd.append("locale", locale);
    translationFetcher.submit(fd, { method: "post" });
  };

  const handleSaveOverride = (locale: string, key: string, value: string) => {
    const fd = new FormData();
    fd.append("intent", "save-translation-override");
    fd.append("locale", locale);
    fd.append("key", key);
    fd.append("value", value);
    translationFetcher.submit(fd, { method: "post" });
    setEditingKey(null);
  };

  const isLocaleActive = (localeCode: string) => activeLocales.includes(localeCode);

  return (
    <Layout>
      {translationFetcher.data && (translationFetcher.data as any).error && !translationBannerDismissed && (
        <Layout.Section>
          <Banner tone="critical" onDismiss={() => setTranslationBannerDismissed(true)}>
            <p>{(translationFetcher.data as any).error}</p>
          </Banner>
        </Layout.Section>
      )}
      {translationFetcher.data && (translationFetcher.data as any).success && !translationBannerDismissed && (
        <Layout.Section>
          <Banner tone="success" onDismiss={() => setTranslationBannerDismissed(true)}>
            <p>Translation settings updated successfully.</p>
          </Banner>
        </Layout.Section>
      )}

      <Layout.AnnotatedSection
        title="Active Locales"
        description="Enable the languages you want to support in your customer return portal. Set a default locale for customers who don't have a preferred language."
      >
        <Card>
          <BlockStack gap="300">
            {supportedLocales.map((locale) => {
              const isActive = isLocaleActive(locale.code);
              const isDefault = defaultLocale === locale.code;
              const isLoading = translationFetcher.state !== "idle" && translationFetcher.formData?.get("locale") === locale.code;

              return (
                <Box key={locale.code} background="bg-surface-secondary" padding="300" borderRadius="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {locale.nativeName}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          ({locale.name})
                        </Text>
                        {isDefault && <Badge tone="info">Default</Badge>}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {locale.code}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center">
                      {isActive && !isDefault && (
                        <Button
                          size="slim"
                          loading={isLoading}
                          onClick={() => handleSetDefault(locale.code)}
                        >
                          Set as Default
                        </Button>
                      )}
                      <Checkbox
                        label=""
                        checked={isActive}
                        disabled={isDefault || isLoading}
                        onChange={() => handleToggleLocale(locale.code, isActive)}
                      />
                    </InlineStack>
                  </InlineStack>
                </Box>
              );
            })}
          </BlockStack>
        </Card>
      </Layout.AnnotatedSection>

      {activeLocales.length > 0 && (
        <Layout.AnnotatedSection
          title="Translation Editor"
          description="Customize translations for any active locale. Leave fields empty to use the default translation."
        >
          <Card>
            <BlockStack gap="400">
              <Select
                label="Select locale to edit"
                options={[
                  { label: "Choose a locale...", value: "" },
                  ...activeLocales.map((code) => {
                    const localeInfo = supportedLocales.find((l) => l.code === code);
                    return {
                      label: `${localeInfo?.nativeName || code} (${localeInfo?.name || code})`,
                      value: code,
                    };
                  }),
                ]}
                value={selectedLocaleForEdit}
                onChange={setSelectedLocaleForEdit}
              />

              {selectedLocaleForEdit && staticTranslations[selectedLocaleForEdit] && (
                <BlockStack gap="500">
                  {Object.entries(translationKeyGroups).map(([groupName, keys]) => {
                    if (keys.length === 0) return null;
                    return (
                      <Box key={groupName}>
                        <BlockStack gap="300">
                          <Divider />
                          <Text as="h3" variant="headingSm" fontWeight="bold">
                            {groupName}
                          </Text>
                          <BlockStack gap="300">
                            {keys.map((key) => {
                              let defaultValue = staticTranslations.en?.[key] || "";
                              if (key.startsWith("portal.reason.") && !defaultValue) {
                                const reasonId = key.replace("portal.reason.", "");
                                const reason = allReasons.find((r) => r.id === reasonId);
                                if (reason) {
                                  defaultValue = reason.label;
                                }
                              }
                              const staticValue = staticTranslations[selectedLocaleForEdit]?.[key] || defaultValue;
                              const overrideValue = currentOverrides[key] || "";
                              const displayValue = overrideValue || staticValue;
                              const isEditing = editingKey === key;

                              return (
                                <Box key={key} background="bg-surface-secondary" padding="300" borderRadius="200">
                                  <BlockStack gap="200">
                                    <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                                      {key}
                                    </Text>
                                    <Box padding="200" background="bg-surface" borderRadius="100">
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        Default (EN): {defaultValue}
                                      </Text>
                                    </Box>
                                    {!isEditing ? (
                                      <InlineStack align="space-between" blockAlign="center">
                                        <Box paddingInline="200">
                                          <Text as="p" variant="bodyMd">
                                            {displayValue || <span style={{ fontStyle: "italic", color: "#9CA3AF" }}>Using default</span>}
                                          </Text>
                                        </Box>
                                        <InlineStack gap="200">
                                          <Button
                                            size="slim"
                                            onClick={() => {
                                              setEditingKey(key);
                                              setEditValue(overrideValue || staticValue);
                                            }}
                                          >
                                            Edit
                                          </Button>
                                          {overrideValue && (
                                            <Button
                                              size="slim"
                                              variant="plain"
                                              tone="critical"
                                              onClick={() => handleSaveOverride(selectedLocaleForEdit, key, "")}
                                            >
                                              Reset
                                            </Button>
                                          )}
                                        </InlineStack>
                                      </InlineStack>
                                    ) : (
                                      <BlockStack gap="200">
                                        <TextField
                                          label=""
                                          value={editValue}
                                          onChange={setEditValue}
                                          autoComplete="off"
                                          multiline={editValue.length > 50}
                                        />
                                        <InlineStack gap="200">
                                          <Button
                                            size="slim"
                                            variant="primary"
                                            onClick={() => handleSaveOverride(selectedLocaleForEdit, key, editValue)}
                                          >
                                            Save
                                          </Button>
                                          <Button
                                            size="slim"
                                            onClick={() => {
                                              setEditingKey(null);
                                              setEditValue("");
                                            }}
                                          >
                                            Cancel
                                          </Button>
                                        </InlineStack>
                                      </BlockStack>
                                    )}
                                  </BlockStack>
                                </Box>
                              );
                            })}
                          </BlockStack>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </BlockStack>
              )}

              {selectedLocaleForEdit && !staticTranslations[selectedLocaleForEdit] && (
                <Box padding="400">
                  <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                    Loading translations...
                  </Text>
                </Box>
              )}

              {!selectedLocaleForEdit && (
                <Box padding="400">
                  <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                    Select a locale to view and edit translations.
                  </Text>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>
      )}

      {activeLocales.length === 0 && (
        <Layout.Section>
          <Banner tone="info">
            <p>No locales are currently active. Enable at least one locale above to start managing translations.</p>
          </Banner>
        </Layout.Section>
      )}
    </Layout>
  );
}
