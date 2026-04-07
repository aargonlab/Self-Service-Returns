import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form, useBlocker } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  TextField,
  Select,
  Button,
  Banner,
  InlineStack,
  FormLayout,
  Box,
  Modal,
  Checkbox,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { createPolicy } from "~/models/returnPolicy.server";
import type { PolicyCondition, PolicyOutcome } from "~/models/returnPolicy.server";
import prisma from "~/db.server";

const FIELD_OPTIONS = [
  { label: "Days since fulfillment", value: "days_since_fulfillment" },
  { label: "Order total", value: "order_total" },
  { label: "Customer return count", value: "customer_return_count" },
  { label: "Return reason", value: "return_reason" },
  { label: "Product title", value: "product_title" },
  { label: "Product SKU", value: "product_sku" },
  { label: "Product tags", value: "product_tag" },
  { label: "Product type", value: "product_type" },
  { label: "Product vendor", value: "product_vendor" },
  { label: "Item price", value: "item_price" },
  { label: "Customer email", value: "customer_email" },
];

const OPERATOR_OPTIONS = [
  { label: "Equals", value: "equals" },
  { label: "Not equals", value: "not_equals" },
  { label: "Contains", value: "contains" },
  { label: "Not contains", value: "not_contains" },
  { label: "Greater than", value: "greater_than" },
  { label: "Less than", value: "less_than" },
];

const TYPE_OPTIONS = [
  { label: "Eligibility — Controls whether orders can be returned", value: "ELIGIBILITY" },
  { label: "Auto Action — Auto-approve or auto-reject returns", value: "AUTO_ACTION" },
  { label: "Exclusion — Exclude specific products from returns", value: "EXCLUSION" },
  { label: "Requirement — Require photos or extra info", value: "REQUIREMENT" },
];

const ACTION_OPTIONS = [
  { label: "Exclude from returns", value: "EXCLUDE" },
  { label: "Auto-approve", value: "AUTO_APPROVE" },
  { label: "Auto-reject", value: "AUTO_REJECT" },
  { label: "Require photo upload", value: "REQUIRE_PHOTO" },
  { label: "Flag for manual review", value: "MANUAL_REVIEW" },
  { label: "Override return window", value: "OVERRIDE_WINDOW" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const reasons = await prisma.customReason.findMany({
    where: { shop: session.shop, active: true },
    select: { id: true, label: true, code: true },
    orderBy: { sortOrder: "asc" },
  });

  return json({ reasons });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const type = formData.get("type") as string;
  const priority = parseInt(formData.get("priority") as string) || 0;
  const outcomeAction = formData.get("outcomeAction") as string;
  const outcomeMessage = formData.get("outcomeMessage") as string;
  const outcomeWindowDays = formData.get("outcomeWindowDays") as string;
  const manualReviewReasonIdsRaw = formData.get("manualReviewReasonIds") as string;
  const manualReviewReasonIds = manualReviewReasonIdsRaw
    ? manualReviewReasonIdsRaw.split(",").filter(Boolean)
    : undefined;

  // Validate policy type
  const validTypes = ["ELIGIBILITY", "AUTO_ACTION", "EXCLUSION", "REQUIREMENT"];
  if (!validTypes.includes(type)) {
    return json({ error: `Invalid policy type: ${type}` }, { status: 400 });
  }

  // Validate outcome action
  const validActions = ["EXCLUDE", "AUTO_APPROVE", "AUTO_REJECT", "REQUIRE_PHOTO", "MANUAL_REVIEW", "OVERRIDE_WINDOW"];
  if (!validActions.includes(outcomeAction)) {
    return json({ error: `Invalid outcome action: ${outcomeAction}` }, { status: 400 });
  }

  // Parse conditions from form
  const conditionCount = parseInt(formData.get("conditionCount") as string) || 0;
  const conditions: PolicyCondition[] = [];
  const validOperators = ["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "in", "not_in"];
  const validFields = ["days_since_fulfillment", "order_total", "customer_return_count", "return_reason", "product_title", "product_sku", "product_tag", "product_type", "product_vendor", "item_price", "customer_email"];

  for (let i = 0; i < conditionCount; i++) {
    const field = formData.get(`condition_${i}_field`) as string;
    const operator = formData.get(`condition_${i}_operator`) as string;
    const value = formData.get(`condition_${i}_value`) as string;

    if (field && operator && value) {
      // Validate field
      if (!validFields.includes(field)) {
        return json({ error: `Invalid condition field: ${field}` }, { status: 400 });
      }

      // Validate operator
      if (!validOperators.includes(operator)) {
        return json({ error: `Invalid operator: ${operator}` }, { status: 400 });
      }

      // Convert numeric values for numeric fields
      const numericFields = ["days_since_fulfillment", "order_total", "customer_return_count", "item_price"];
      let finalValue: string | number | string[] = value;
      if (numericFields.includes(field)) {
        const numValue = Number(value);
        // Bug #9 Fix: Validate that conversion didn't produce NaN and is finite
        if (isNaN(numValue) || !isFinite(numValue) || numValue < 0) {
          return json({ error: `Invalid numeric value for field: ${field}` }, { status: 400 });
        }
        finalValue = numValue;
      }
      // Parse return_reason "in" operator as array of reason codes
      if (field === "return_reason" && operator === "in") {
        finalValue = value.split(",").filter(Boolean);
      }
      conditions.push({
        field,
        operator: operator as PolicyCondition["operator"],
        value: finalValue,
      });
    }
  }

  if (!name || !type || conditions.length === 0 || !outcomeAction) {
    return json({ error: "Please fill in all required fields and add at least one condition." }, { status: 400 });
  }

  const outcome: PolicyOutcome = {
    action: outcomeAction as PolicyOutcome["action"],
    message: outcomeMessage || undefined,
    returnWindowDays: outcomeWindowDays ? parseInt(outcomeWindowDays) : undefined,
    manualReviewReasonIds: outcomeAction === "AUTO_APPROVE" ? manualReviewReasonIds : undefined,
  };

  try {
    await createPolicy({
      shop: session.shop,
      name,
      description: description || undefined,
      type: type as any,
      priority,
      conditions,
      outcome,
    });
    return redirect("/app/policies");
  } catch (error) {
    return json({ error: "Failed to create policy." }, { status: 500 });
  }
};

export default function NewPolicy() {
  const { reasons } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("EXCLUSION");
  const [priority, setPriority] = useState("0");
  const [conditions, setConditions] = useState<Array<{ field: string; operator: string; value: string }>>([
    { field: "product_tag", operator: "contains", value: "" },
  ]);
  const [outcomeAction, setOutcomeAction] = useState("EXCLUDE");
  const [outcomeMessage, setOutcomeMessage] = useState("");
  const [outcomeWindowDays, setOutcomeWindowDays] = useState("");
  const [manualReviewReasonIds, setManualReviewReasonIds] = useState<string[]>([]);

  const addCondition = useCallback(() => {
    setConditions((prev) => [...prev, { field: "product_tag", operator: "contains", value: "" }]);
  }, []);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateCondition = useCallback((index: number, key: string, value: string) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, [key]: value } : c)));
  }, []);

  function getValuePlaceholder(field: string): string {
    switch (field) {
      case "days_since_fulfillment": return "e.g. 30";
      case "order_total": return "e.g. 100.00";
      case "customer_return_count": return "e.g. 3";
      case "return_reason": return "e.g. defective";
      case "product_title": return "e.g. T-Shirt";
      case "product_sku": return "e.g. SKU-001";
      case "product_tag": return "e.g. final-sale";
      case "product_type": return "e.g. Electronics";
      case "product_vendor": return "e.g. Apple";
      case "item_price": return "e.g. 100.00";
      case "customer_email": return "e.g. customer@example.com";
      default: return "";
    }
  }

  const [errorDismissed, setErrorDismissed] = useState(false);

  // Reset error dismissal on new actionData
  useEffect(() => {
    if (actionData) setErrorDismissed(false);
  }, [actionData]);

  // Track unsaved changes
  const isDirty = name.trim() !== "" || conditions.some(c => c.value.trim() !== "") || outcomeAction !== "EXCLUDE";
  const blocker = useBlocker(isDirty && navigation.state === "idle");

  return (
    <Page
      backAction={{ content: "Policies", url: "/app/policies" }}
      title="Create Policy"
    >
      {actionData && "error" in actionData && !errorDismissed && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>{(actionData as any).error}</Banner>
        </div>
      )}

      <Form method="post">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Policy Details</Text>
                <FormLayout>
                  <TextField label="Name" name="name" value={name} onChange={setName} autoComplete="off" requiredIndicator />
                  <TextField label="Description (optional)" name="description" value={description} onChange={setDescription} autoComplete="off" multiline={2} />
                  <Select label="Policy type" name="type" options={TYPE_OPTIONS} value={type} onChange={setType} />
                  <TextField label="Priority" name="priority" type="number" value={priority} onChange={setPriority} autoComplete="off" helpText="Higher priority policies are evaluated first (0 = lowest, 100 = highest)." />
                </FormLayout>
              </BlockStack>
            </Card>

            <div style={{ marginTop: "16px" }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Conditions</Text>
                    <Button onClick={addCondition} size="slim">Add condition</Button>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">All conditions must match for this policy to apply (AND logic).</Text>

                  <input type="hidden" name="conditionCount" value={conditions.length} />

                  {conditions.map((condition, index) => (
                    <Box key={index} background="bg-surface-secondary" padding="300" borderRadius="200">
                      {condition.field === "return_reason" ? (
                        <BlockStack gap="200">
                          <InlineStack gap="200" blockAlign="end" wrap>
                            <div style={{ flex: 1 }}>
                              <Select
                                label="Field"
                                name={`condition_${index}_field`}
                                options={FIELD_OPTIONS}
                                value={condition.field}
                                onChange={(v) => {
                                  updateCondition(index, "field", v);
                                  if (v !== "return_reason") {
                                    updateCondition(index, "operator", "equals");
                                    updateCondition(index, "value", "");
                                  }
                                }}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <Text as="p" variant="bodySm" tone="subdued">Matches any of the selected reasons</Text>
                            </div>
                            {conditions.length > 1 && (
                              <Button tone="critical" size="slim" onClick={() => removeCondition(index)}>
                                Remove
                              </Button>
                            )}
                          </InlineStack>
                          <input type="hidden" name={`condition_${index}_operator`} value="in" />
                          <input type="hidden" name={`condition_${index}_value`} value={condition.value} />
                          {reasons.length > 0 ? (
                            <BlockStack gap="100">
                              {reasons.map((reason) => {
                                const selectedCodes = condition.value ? condition.value.split(",").filter(Boolean) : [];
                                return (
                                  <Checkbox
                                    key={reason.id}
                                    label={`${reason.label} (${reason.code})`}
                                    checked={selectedCodes.includes(reason.code)}
                                    onChange={(checked) => {
                                      const codes = condition.value ? condition.value.split(",").filter(Boolean) : [];
                                      const updated = checked
                                        ? [...codes, reason.code]
                                        : codes.filter((c) => c !== reason.code);
                                      updateCondition(index, "value", updated.join(","));
                                    }}
                                  />
                                );
                              })}
                            </BlockStack>
                          ) : (
                            <Text as="p" variant="bodySm" tone="caution">No active return reasons configured. Add reasons in Settings first.</Text>
                          )}
                        </BlockStack>
                      ) : (
                      <InlineStack gap="200" blockAlign="end" wrap>
                        <div style={{ flex: 1 }}>
                          <Select
                            label="Field"
                            name={`condition_${index}_field`}
                            options={FIELD_OPTIONS}
                            value={condition.field}
                            onChange={(v) => {
                              updateCondition(index, "field", v);
                              if (v === "return_reason") {
                                updateCondition(index, "operator", "in");
                                updateCondition(index, "value", "");
                              }
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <Select
                            label="Operator"
                            name={`condition_${index}_operator`}
                            options={OPERATOR_OPTIONS}
                            value={condition.operator}
                            onChange={(v) => updateCondition(index, "operator", v)}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Value"
                            name={`condition_${index}_value`}
                            value={condition.value}
                            onChange={(v) => updateCondition(index, "value", v)}
                            placeholder={getValuePlaceholder(condition.field)}
                            autoComplete="off"
                          />
                        </div>
                        {conditions.length > 1 && (
                          <Button tone="critical" size="slim" onClick={() => removeCondition(index)}>
                            Remove
                          </Button>
                        )}
                      </InlineStack>
                      )}
                    </Box>
                  ))}
                </BlockStack>
              </Card>
            </div>

            <div style={{ marginTop: "16px" }}>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Outcome</Text>
                  <FormLayout>
                    <Select label="Action" name="outcomeAction" options={ACTION_OPTIONS} value={outcomeAction} onChange={setOutcomeAction} />
                    <TextField label="Message (shown to customer)" name="outcomeMessage" value={outcomeMessage} onChange={setOutcomeMessage} autoComplete="off" multiline={2} helpText="Optional message explaining why this policy applies." />
                    {outcomeAction === "OVERRIDE_WINDOW" && (
                      <TextField label="Return window (days)" name="outcomeWindowDays" type="number" value={outcomeWindowDays} onChange={setOutcomeWindowDays} autoComplete="off" helpText="Override the default return window for matching orders." />
                    )}
                    {outcomeAction === "AUTO_APPROVE" && reasons.length > 0 && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          Require manual approval for these reasons
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Returns with any of these reasons will require manual approval by the customer care team, even though this policy auto-approves.
                        </Text>
                        {reasons.map((reason) => (
                          <Checkbox
                            key={reason.id}
                            label={`${reason.label} (${reason.code})`}
                            checked={manualReviewReasonIds.includes(reason.id)}
                            onChange={(checked) => {
                              setManualReviewReasonIds((prev) =>
                                checked ? [...prev, reason.id] : prev.filter((id) => id !== reason.id)
                              );
                            }}
                          />
                        ))}
                      </BlockStack>
                    )}
                  </FormLayout>
                  <input type="hidden" name="manualReviewReasonIds" value={manualReviewReasonIds.join(",")} />
                </BlockStack>
              </Card>
            </div>

            <div style={{ marginTop: "16px" }}>
              <InlineStack align="end">
                <Button
                  submit
                  variant="primary"
                  loading={isSaving}
                  disabled={
                    isSaving ||
                    !name.trim() ||
                    conditions.length === 0 ||
                    conditions.some(c => {
                      if (!c.value.trim()) return true;
                      const numericFields = ["days_since_fulfillment", "order_total", "customer_return_count", "item_price"];
                      if (numericFields.includes(c.field) && (c.operator === "greater_than" || c.operator === "less_than")) {
                        return isNaN(Number(c.value));
                      }
                      return false;
                    })
                  }
                >
                  Create Policy
                </Button>
              </InlineStack>
            </div>
          </Layout.Section>
        </Layout>
      </Form>

      {blocker.state === "blocked" && (
        <Modal
          open
          onClose={() => blocker.reset?.()}
          title="Discard unsaved changes?"
          primaryAction={{ content: "Discard", onAction: () => blocker.proceed?.(), destructive: true }}
          secondaryActions={[{ content: "Keep editing", onAction: () => blocker.reset?.() }]}
        >
          <Modal.Section>
            <p>You have unsaved changes. Are you sure you want to leave?</p>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
