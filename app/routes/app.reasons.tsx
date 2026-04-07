import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation, Form, useActionData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  InlineStack,
  BlockStack,
  TextField,
  Checkbox,
  ChoiceList,
  Modal,
  FormLayout,
  Banner,
  SkeletonPage,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import {
  listReasons,
  ensureDefaultReasons,
  createReason,
  updateReason,
  deleteReason,
  getReason,
} from "~/models/customReason.server";
import { fetchMarkets } from "~/services/shopifyMarkets.server";
import type { CustomReason } from "@prisma/client";
import { RETURN_REASONS } from "~/utils/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Ensure defaults exist (catch errors so page still loads)
  try {
    await ensureDefaultReasons(session.shop);
  } catch (e) {
    console.error("Failed to seed default reasons:", e);
  }

  const [reasons, marketsResult] = await Promise.all([
    listReasons(session.shop),
    fetchMarkets(admin),
  ]);

  return json({
    reasons,
    markets: marketsResult.markets,
    marketsError: marketsResult.error || null,
    shop: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const label = formData.get("label") as string;
    let code = formData.get("code") as string;
    const description = formData.get("description") as string;
    const appliesToReturn = formData.get("appliesToReturn") === "true";
    const appliesToReplacement = formData.get("appliesToReplacement") === "true";
    const requiresNote = formData.get("requiresNote") === "true";
    const customerVisible = formData.get("customerVisible") !== "false";
    const requiresShoppingEligibility = formData.get("requiresShoppingEligibility") === "true";
    const marketsJson = formData.get("markets") as string;
    const replacementExcludedMarketsJson = formData.get("replacementExcludedMarkets") as string;

    let markets: string[] = [];
    try {
      markets = marketsJson ? JSON.parse(marketsJson) : [];
    } catch (e) {
      // BUG 3 FIX: Log parse failures for visibility
      console.warn("[Reasons] Failed to parse markets JSON:", e);
      markets = [];
    }

    let replacementExcludedMarkets: string[] = [];
    try {
      replacementExcludedMarkets = replacementExcludedMarketsJson ? JSON.parse(replacementExcludedMarketsJson) : [];
    } catch (e) {
      console.warn("[Reasons] Failed to parse replacementExcludedMarkets JSON:", e);
      replacementExcludedMarkets = [];
    }

    // Validate
    if (!label) {
      return json({ error: "Label is required" }, { status: 400 });
    }

    // Auto-generate code if not provided (replace hyphens with underscores)
    if (!code) {
      code = label.toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "").replace(/-+/g, "_");
    } else {
      // If code is provided, replace hyphens with underscores
      code = code.replace(/-+/g, "_");
    }

    // Check against legacy/default reason codes
    const legacyCodes = Object.keys(RETURN_REASONS);
    if (legacyCodes.includes(code)) {
      return json({ error: "Code conflicts with a built-in reason code. Please use a different code." }, { status: 400 });
    }

    try {
      await createReason({
        shop: session.shop,
        code,
        label,
        description: description || undefined,
        appliesToReturn,
        appliesToReplacement,
        requiresNote,
        customerVisible,
        markets,
        replacementExcludedMarkets,
        requiresShoppingEligibility,
      });
      return json({ success: true });
    } catch (error) {
      console.error("Error creating reason:", error);
      return json({ error: "Failed to create reason" }, { status: 500 });
    }
  }

  if (intent === "update") {
    const id = formData.get("id") as string;
    const label = formData.get("label") as string;
    const description = formData.get("description") as string;
    const appliesToReturn = formData.get("appliesToReturn") === "true";
    const appliesToReplacement = formData.get("appliesToReplacement") === "true";
    const requiresNote = formData.get("requiresNote") === "true";
    const customerVisible = formData.get("customerVisible") !== "false";
    const requiresShoppingEligibility = formData.get("requiresShoppingEligibility") === "true";
    const marketsJson = formData.get("markets") as string;
    const replacementExcludedMarketsJson = formData.get("replacementExcludedMarkets") as string;

    let markets: string[] = [];
    try {
      markets = marketsJson ? JSON.parse(marketsJson) : [];
    } catch (e) {
      // BUG 3 FIX: Log parse failures for visibility
      console.warn("[Reasons] Failed to parse markets JSON:", e);
      markets = [];
    }

    let replacementExcludedMarkets: string[] = [];
    try {
      replacementExcludedMarkets = replacementExcludedMarketsJson ? JSON.parse(replacementExcludedMarketsJson) : [];
    } catch (e) {
      console.warn("[Reasons] Failed to parse replacementExcludedMarkets JSON:", e);
      replacementExcludedMarkets = [];
    }

    // Validate ownership
    const reason = await getReason(id, session.shop);
    if (!reason) {
      return json({ error: "Reason not found" }, { status: 404 });
    }

    try {
      await updateReason(id, session.shop, {
        label,
        description: description || undefined,
        appliesToReturn,
        appliesToReplacement,
        requiresNote,
        customerVisible,
        markets,
        replacementExcludedMarkets,
        requiresShoppingEligibility,
      });
      return json({ success: true });
    } catch (error) {
      console.error("Error updating reason:", error);
      return json({ error: "Failed to update reason" }, { status: 500 });
    }
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;

    // Validate ownership
    const reason = await getReason(id, session.shop);
    if (!reason) {
      return json({ error: "Reason not found" }, { status: 404 });
    }

    try {
      await deleteReason(id, session.shop);
      return json({ success: true });
    } catch (error) {
      console.error("Error deleting reason:", error);
      return json({ error: "Failed to delete reason" }, { status: 500 });
    }
  }

  if (intent === "toggle-active") {
    const id = formData.get("id") as string;
    const active = formData.get("active") === "true";

    // Validate ownership
    const reason = await getReason(id, session.shop);
    if (!reason) {
      return json({ error: "Reason not found" }, { status: 404 });
    }

    try {
      await updateReason(id, session.shop, { active: !active });
      return json({ success: true });
    } catch (error) {
      console.error("Error toggling reason:", error);
      return json({ error: "Failed to toggle reason" }, { status: 500 });
    }
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function ReasonsPage() {
  const { reasons, markets, marketsError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const toggleFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  // Create form state
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [appliesToReturn, setAppliesToReturn] = useState(true);
  const [appliesToReplacement, setAppliesToReplacement] = useState(false);
  const [requiresNote, setRequiresNote] = useState(false);
  const [customerVisible, setCustomerVisible] = useState(true);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [restrictMarkets, setRestrictMarkets] = useState(false);
  const [replacementExcludedMarkets, setReplacementExcludedMarkets] = useState<string[]>([]);
  const [requiresShoppingEligibility, setRequiresShoppingEligibility] = useState(false);

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingReason, setEditingReason] = useState<CustomReason | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAppliesToReturn, setEditAppliesToReturn] = useState(true);
  const [editAppliesToReplacement, setEditAppliesToReplacement] = useState(false);
  const [editRequiresNote, setEditRequiresNote] = useState(false);
  const [editCustomerVisible, setEditCustomerVisible] = useState(true);
  const [editSelectedMarkets, setEditSelectedMarkets] = useState<string[]>([]);
  const [editRestrictMarkets, setEditRestrictMarkets] = useState(false);
  const [editSubmitted, setEditSubmitted] = useState(false);
  const [editReplacementExcludedMarkets, setEditReplacementExcludedMarkets] = useState<string[]>([]);
  const [editRequiresShoppingEligibility, setEditRequiresShoppingEligibility] = useState(false);

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingReason, setDeletingReason] = useState<CustomReason | null>(null);

  // Error banner state
  const [errorDismissed, setErrorDismissed] = useState(false);

  // Toggle state tracking
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Auto-generate code from label
  useEffect(() => {
    if (label && !code) {
      const generatedCode = label
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // strip diacritics
        .replace(/[^a-zA-Z0-9\s_-]/g, "") // strip non-ASCII
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_")
        .replace(/-+/g, "_") // replace hyphens with underscores
        .substring(0, 50);
      setCode(generatedCode);
    }
  }, [label, code]);

  // Reset form after successful submission
  useEffect(() => {
    if ((actionData as any)?.success && !isSubmitting) {
      setLabel("");
      setCode("");
      setDescription("");
      setAppliesToReturn(true);
      setAppliesToReplacement(false);
      setRequiresNote(false);
      setCustomerVisible(true);
      setSelectedMarkets([]);
      setRestrictMarkets(false);
      setReplacementExcludedMarkets([]);
      setRequiresShoppingEligibility(false);
      // Only close edit modal if it was the one that submitted
      if (editSubmitted && !(actionData as any)?.error) {
        setEditModalOpen(false);
        setEditSubmitted(false);
      }
    }
  }, [actionData, isSubmitting, editSubmitted]);

  // Reset error dismissal when actionData changes
  useEffect(() => {
    if (actionData) {
      setErrorDismissed(false);
    }
  }, [actionData]);

  // Show toast for successful actions
  useEffect(() => {
    if ((actionData as any)?.success && !isSubmitting) {
      shopify.toast.show("Reason saved successfully");
    }
  }, [actionData, isSubmitting]);

  // Clear toggling ID when fetcher goes idle
  useEffect(() => {
    if (toggleFetcher.state === "idle") {
      setTogglingId(null);
      // Show toast for toggle success
      if (toggleFetcher.data && (toggleFetcher.data as any).success) {
        shopify.toast.show("Reason updated");
      }
    }
  }, [toggleFetcher.state, toggleFetcher.data]);

  // Close delete modal after successful deletion
  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data && (deleteFetcher.data as any).success) {
      setDeleteModalOpen(false);
      setDeletingReason(null);
      shopify.toast.show("Reason deleted");
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  const handleEdit = useCallback((reason: CustomReason) => {
    setEditingReason(reason);
    setEditLabel(reason.label);
    setEditDescription(reason.description || "");
    setEditAppliesToReturn(reason.appliesToReturn);
    setEditAppliesToReplacement(reason.appliesToReplacement);
    setEditRequiresNote(reason.requiresNote);
    setEditCustomerVisible(reason.customerVisible);
    setEditSelectedMarkets((reason.markets as string[]) || []);
    setEditRestrictMarkets((reason.markets as string[])?.length > 0);
    setEditReplacementExcludedMarkets((reason.replacementExcludedMarkets as string[]) || []);
    setEditRequiresShoppingEligibility((reason as any).requiresShoppingEligibility || false);
    setEditModalOpen(true);
  }, []);

  const handleDelete = useCallback((reason: CustomReason) => {
    setDeletingReason(reason);
    setDeleteModalOpen(true);
  }, []);

  const marketChoices = markets.map((market) => ({
    label: market.name,
    value: market.id,
  }));

  if (navigation.state === "loading") {
    return (
      <SkeletonPage title="Return & Replacement Reasons" primaryAction>
        <BlockStack gap="500">
          <Card>
            <SkeletonBodyText lines={5} />
          </Card>
          <Card>
            <SkeletonBodyText lines={8} />
          </Card>
        </BlockStack>
      </SkeletonPage>
    );
  }

  return (
    <Page title="Return & Replacement Reasons">
      <BlockStack gap="500">
        {(actionData as any)?.error && !errorDismissed && (
          <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>
            {(actionData as any).error}
          </Banner>
        )}

        {marketsError && (
          <Banner tone="warning">
            <p>Could not load Shopify Markets: {marketsError}</p>
            <p>Run <strong>shopify app dev</strong> to reinstall the app with updated scopes, or add <strong>read_markets</strong> to your app scopes.</p>
          </Banner>
        )}

        {/* Create Form */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Create New Reason
            </Text>
            <Form method="post">
              <input type="hidden" name="intent" value="create" />
              <input type="hidden" name="markets" value={JSON.stringify(selectedMarkets)} />
              <input type="hidden" name="replacementExcludedMarkets" value={JSON.stringify(replacementExcludedMarkets)} />
              <FormLayout>
                <FormLayout.Group>
                  <TextField
                    label="Label"
                    value={label}
                    onChange={setLabel}
                    name="label"
                    autoComplete="off"
                    requiredIndicator
                  />
                  <TextField
                    label="Code"
                    value={code}
                    onChange={setCode}
                    name="code"
                    autoComplete="off"
                    helpText="Auto-generated from label, but you can customize it"
                  />
                </FormLayout.Group>
                <TextField
                  label="Description"
                  value={description}
                  onChange={setDescription}
                  name="description"
                  autoComplete="off"
                  multiline={2}
                />
                <BlockStack gap="300">
                  <Checkbox
                    label="Available for returns"
                    checked={appliesToReturn}
                    onChange={setAppliesToReturn}
                  />
                  <input type="hidden" name="appliesToReturn" value={String(appliesToReturn)} />
                  <Checkbox
                    label="Available for replacements"
                    checked={appliesToReplacement}
                    onChange={(checked) => {
                      setAppliesToReplacement(checked);
                      if (!checked) setReplacementExcludedMarkets([]);
                    }}
                  />
                  <input type="hidden" name="appliesToReplacement" value={String(appliesToReplacement)} />
                  {appliesToReplacement && markets.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        Exclude replacement from specific markets:
                      </Text>
                      {markets.map((market) => (
                        <Checkbox
                          key={market.id}
                          label={`Exclude ${market.name}`}
                          checked={replacementExcludedMarkets.includes(market.id)}
                          onChange={(checked) => {
                            if (checked) {
                              setReplacementExcludedMarkets([...replacementExcludedMarkets, market.id]);
                            } else {
                              setReplacementExcludedMarkets(
                                replacementExcludedMarkets.filter((id) => id !== market.id)
                              );
                            }
                          }}
                        />
                      ))}
                    </BlockStack>
                  )}
                  <Checkbox
                    label="Require customer note"
                    checked={requiresNote}
                    onChange={setRequiresNote}
                  />
                  <input type="hidden" name="requiresNote" value={String(requiresNote)} />
                  <Checkbox
                    label="Visible to customers"
                    checked={customerVisible}
                    onChange={setCustomerVisible}
                    helpText="When unchecked, this reason is only available to store staff in the admin"
                  />
                  <input type="hidden" name="customerVisible" value={String(customerVisible)} />
                  <Checkbox
                    label="Requires Shipping Eligibility disclaimer"
                    checked={requiresShoppingEligibility}
                    onChange={setRequiresShoppingEligibility}
                    helpText="When checked, customers must accept a legal disclaimer before their return can be approved"
                  />
                  <input type="hidden" name="requiresShoppingEligibility" value={String(requiresShoppingEligibility)} />
                </BlockStack>
                {markets.length > 0 && (
                  <BlockStack gap="200">
                    <Checkbox
                      label="Restrict to specific markets"
                      checked={restrictMarkets}
                      onChange={(checked) => {
                        setRestrictMarkets(checked);
                        if (!checked) setSelectedMarkets([]);
                      }}
                      helpText="When unchecked, this reason is available in all markets"
                    />
                    {restrictMarkets && (
                      <ChoiceList
                        title="Select markets"
                        allowMultiple
                        choices={marketChoices}
                        selected={selectedMarkets}
                        onChange={setSelectedMarkets}
                      />
                    )}
                  </BlockStack>
                )}
                <Button submit variant="primary" loading={isSubmitting} disabled={isSubmitting || !label.trim()}>
                  Add Reason
                </Button>
              </FormLayout>
            </Form>
          </BlockStack>
        </Card>

        {/* Reasons List */}
        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "reason", plural: "reasons" }}
            itemCount={reasons.length}
            headings={[
              { title: "Label" },
              { title: "Code" },
              { title: "Type" },
              { title: "Status" },
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {reasons.map((reason, index) => (
              <IndexTable.Row id={reason.id} key={reason.id} position={index}>
                <IndexTable.Cell>
                  <div style={{ maxWidth: "360px", whiteSpace: "normal", wordBreak: "break-word" }}>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {reason.label}
                      </Text>
                      <InlineStack gap="100" wrap>
                        {reason.requiresNote && <Badge tone="attention">Note required</Badge>}
                        {!reason.customerVisible && <Badge tone="warning">Admin only</Badge>}
                        {(reason.markets as string[])?.length > 0 && (
                          <Badge tone="info">
                            {(reason.markets as string[]).map((id) => {
                              const market = markets.find((m) => m.id === id);
                              return market?.name || id;
                            }).join(", ")}
                          </Badge>
                        )}
                        {(reason as any).requiresShoppingEligibility && <Badge tone="warning">Shipping Eligibility</Badge>}
                      </InlineStack>
                    </BlockStack>
                  </div>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {reason.code}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="100" wrap>
                    {reason.appliesToReturn && <Badge tone="info">Return</Badge>}
                    {reason.appliesToReplacement && <Badge tone="success">Replacement</Badge>}
                    {!reason.appliesToReturn && !reason.appliesToReplacement && (
                      <Badge tone="warning">None</Badge>
                    )}
                  </InlineStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <toggleFetcher.Form method="post">
                    <input type="hidden" name="intent" value="toggle-active" />
                    <input type="hidden" name="id" value={reason.id} />
                    <input type="hidden" name="active" value={String(reason.active)} />
                    <Button
                      submit
                      size="slim"
                      variant={reason.active ? "primary" : "plain"}
                      loading={togglingId === reason.id && toggleFetcher.state !== "idle"}
                      disabled={toggleFetcher.state !== "idle"}
                      onClick={() => {
                        setTogglingId(reason.id);
                      }}
                    >
                      {reason.active ? "Active" : "Inactive"}
                    </Button>
                  </toggleFetcher.Form>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200">
                    <Button size="slim" onClick={() => handleEdit(reason as any)}>
                      Edit
                    </Button>
                    <Button size="slim" tone="critical" onClick={() => handleDelete(reason as any)}>
                      Delete
                    </Button>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>

      {/* Edit Modal */}
      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit Reason"
        primaryAction={{
          content: "Save",
          loading: isSubmitting,
          disabled: !editLabel.trim(),
          onAction: () => {
            setEditSubmitted(true);
            const form = document.getElementById("edit-form") as HTMLFormElement;
            form?.requestSubmit();
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setEditModalOpen(false) }]}
      >
        <Modal.Section>
          <Form method="post" id="edit-form">
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="id" value={editingReason?.id || ""} />
            <input type="hidden" name="markets" value={JSON.stringify(editSelectedMarkets)} />
            <input type="hidden" name="replacementExcludedMarkets" value={JSON.stringify(editReplacementExcludedMarkets)} />
            <FormLayout>
              <TextField
                label="Label"
                value={editLabel}
                onChange={setEditLabel}
                name="label"
                autoComplete="off"
                requiredIndicator
              />
              <TextField
                label="Description"
                value={editDescription}
                onChange={setEditDescription}
                name="description"
                autoComplete="off"
                multiline={2}
              />
              <BlockStack gap="300">
                <Checkbox
                  label="Available for returns"
                  checked={editAppliesToReturn}
                  onChange={setEditAppliesToReturn}
                />
                <input type="hidden" name="appliesToReturn" value={String(editAppliesToReturn)} />
                <Checkbox
                  label="Available for replacements"
                  checked={editAppliesToReplacement}
                  onChange={(checked) => {
                    setEditAppliesToReplacement(checked);
                    if (!checked) setEditReplacementExcludedMarkets([]);
                  }}
                />
                <input
                  type="hidden"
                  name="appliesToReplacement"
                  value={String(editAppliesToReplacement)}
                />
                {editAppliesToReplacement && markets.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      Exclude replacement from specific markets:
                    </Text>
                    {markets.map((market) => (
                      <Checkbox
                        key={market.id}
                        label={`Exclude ${market.name}`}
                        checked={editReplacementExcludedMarkets.includes(market.id)}
                        onChange={(checked) => {
                          if (checked) {
                            setEditReplacementExcludedMarkets([...editReplacementExcludedMarkets, market.id]);
                          } else {
                            setEditReplacementExcludedMarkets(
                              editReplacementExcludedMarkets.filter((id) => id !== market.id)
                            );
                          }
                        }}
                      />
                    ))}
                  </BlockStack>
                )}
                <Checkbox
                  label="Require customer note"
                  checked={editRequiresNote}
                  onChange={setEditRequiresNote}
                />
                <input type="hidden" name="requiresNote" value={String(editRequiresNote)} />
                <Checkbox
                  label="Visible to customers"
                  checked={editCustomerVisible}
                  onChange={setEditCustomerVisible}
                  helpText="When unchecked, this reason is only available to store staff in the admin"
                />
                <input type="hidden" name="customerVisible" value={String(editCustomerVisible)} />
                <Checkbox
                  label="Requires Shipping Eligibility disclaimer"
                  checked={editRequiresShoppingEligibility}
                  onChange={setEditRequiresShoppingEligibility}
                  helpText="When checked, customers must accept a legal disclaimer before their return can be approved"
                />
                <input type="hidden" name="requiresShoppingEligibility" value={String(editRequiresShoppingEligibility)} />
              </BlockStack>
              {markets.length > 0 && (
                <BlockStack gap="200">
                  <Checkbox
                    label="Restrict to specific markets"
                    checked={editRestrictMarkets}
                    onChange={(checked) => {
                      setEditRestrictMarkets(checked);
                      if (!checked) setEditSelectedMarkets([]);
                    }}
                    helpText="When unchecked, this reason is available in all markets"
                  />
                  {editRestrictMarkets && (
                    <ChoiceList
                      title="Select markets"
                      allowMultiple
                      choices={marketChoices}
                      selected={editSelectedMarkets}
                      onChange={setEditSelectedMarkets}
                    />
                  )}
                </BlockStack>
              )}
            </FormLayout>
          </Form>
        </Modal.Section>
      </Modal>

      {/* Delete Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Reason?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: deleteFetcher.state !== "idle",
          onAction: () => {
            if (deletingReason) {
              const formData = new FormData();
              formData.append("intent", "delete");
              formData.append("id", deletingReason.id);
              deleteFetcher.submit(formData, { method: "post" });
            }
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteModalOpen(false) }]}
      >
        <Modal.Section>
          <p>
            Are you sure you want to delete "{deletingReason?.label}"? This action cannot be
            undone.
          </p>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
