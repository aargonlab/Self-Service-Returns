import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form, useBeforeUnload, useBlocker } from "@remix-run/react";
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
import { useState, useCallback, useEffect, useRef } from "react";
import { authenticate } from "~/shopify.server";
import { getPolicy, updatePolicy } from "~/models/returnPolicy.server";
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


const ACTION_OPTIONS = [
  { label: "Exclude from returns", value: "EXCLUDE" },
  { label: "Auto-approve", value: "AUTO_APPROVE" },
  { label: "Auto-reject", value: "AUTO_REJECT" },
  { label: "Require photo upload", value: "REQUIRE_PHOTO" },
  { label: "Flag for manual review", value: "MANUAL_REVIEW" },
  { label: "Override return window", value: "OVERRIDE_WINDOW" },
];

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  if (!params.id) {
    throw new Response("Not found", { status: 404 });
  }

  const policy = await getPolicy(params.id, session.shop);

  if (!policy) {
    throw new Response("Not found", { status: 404 });
  }

  const reasons = await prisma.customReason.findMany({
    where: { shop: session.shop, active: true },
    select: { id: true, label: true, code: true },
    orderBy: { sortOrder: "asc" },
  });

  return json({ policy, reasons });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (!params.id) {
    return json({ error: "Policy not found." }, { status: 404 });
  }

  const policy = await getPolicy(params.id, session.shop);
  if (!policy) {
    return json({ error: "Policy not found." }, { status: 404 });
  }

  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const priority = parseInt(formData.get("priority") as string) || 0;
  const outcomeAction = formData.get("outcomeAction") as string;
  const outcomeMessage = formData.get("outcomeMessage") as string;
  const outcomeWindowDays = formData.get("outcomeWindowDays") as string;
  const manualReviewReasonIdsRaw = formData.get("manualReviewReasonIds") as string;
  const manualReviewReasonIds = manualReviewReasonIdsRaw
    ? manualReviewReasonIdsRaw.split(",").filter(Boolean)
    : undefined;

  // Validate outcome action
  const validActions = ["EXCLUDE", "AUTO_APPROVE", "AUTO_REJECT", "REQUIRE_PHOTO", "MANUAL_REVIEW", "OVERRIDE_WINDOW"];
  if (!validActions.includes(outcomeAction)) {
    return json({ error: `Invalid outcome action: ${outcomeAction}` }, { status: 400 });
  }

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

  if (!name || conditions.length === 0 || !outcomeAction) {
    return json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  const outcome: PolicyOutcome = {
    action: outcomeAction as PolicyOutcome["action"],
    message: outcomeMessage || undefined,
    returnWindowDays: outcomeWindowDays ? parseInt(outcomeWindowDays) : undefined,
    manualReviewReasonIds: outcomeAction === "AUTO_APPROVE" ? manualReviewReasonIds : undefined,
  };

  try {
    await updatePolicy(params.id!, session.shop, { name, description: description || undefined, priority, conditions, outcome });
    return redirect("/app/policies");
  } catch (error) {
    return json({ error: "Failed to update policy." }, { status: 500 });
  }
};

export default function EditPolicy() {
  const { policy, reasons } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const existingConditions = (policy.conditions as unknown as PolicyCondition[]).map((c) => ({
    field: c.field,
    operator: c.operator,
    value: String(c.value),
  }));
  const existingOutcome = policy.outcome as unknown as PolicyOutcome;

  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description || "");
  const [priority, setPriority] = useState(String(policy.priority));
  const [conditions, setConditions] = useState(existingConditions);
  const [outcomeAction, setOutcomeAction] = useState(existingOutcome.action);
  const [outcomeMessage, setOutcomeMessage] = useState(existingOutcome.message || "");
  const [outcomeWindowDays, setOutcomeWindowDays] = useState(existingOutcome.returnWindowDays ? String(existingOutcome.returnWindowDays) : "");
  const [manualReviewReasonIds, setManualReviewReasonIds] = useState<string[]>(
    existingOutcome.manualReviewReasonIds || []
  );
  const [nameError, setNameError] = useState("");
  const [errorDismissed, setErrorDismissed] = useState(false);

  // Reset error dismissal on new actionData
  useEffect(() => {
    if (actionData) setErrorDismissed(false);
  }, [actionData]);

  // Reset all form state when navigating between policies (Bug #195)
  useEffect(() => {
    const existingConditions = (policy.conditions as unknown as PolicyCondition[]).map((c) => ({
      field: c.field,
      operator: c.operator,
      value: String(c.value),
    }));
    const existingOutcome = policy.outcome as unknown as PolicyOutcome;

    setName(policy.name);
    setDescription(policy.description || "");
    setPriority(String(policy.priority));
    setConditions(existingConditions);
    setOutcomeAction(existingOutcome.action);
    setOutcomeMessage(existingOutcome.message || "");
    setOutcomeWindowDays(existingOutcome.returnWindowDays ? String(existingOutcome.returnWindowDays) : "");
    setManualReviewReasonIds(existingOutcome.manualReviewReasonIds || []);
    setNameError("");
    setErrorDismissed(false);
  }, [policy.id]);

  const addCondition = useCallback(() => {
    setConditions((prev) => [...prev, { field: "product_tag", operator: "contains", value: "" }]);
  }, []);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateConditionState = useCallback((index: number, key: string, value: string) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, [key]: value } : c)));
  }, []);

  const getValuePlaceholder = (field: string) => {
    switch(field) {
      case "days_since_fulfillment": return "e.g., 30";
      case "order_total": return "e.g., 100.00";
      case "customer_return_count": return "e.g., 3";
      case "return_reason": return "e.g., DAMAGED";
      case "product_title": return "e.g., T-Shirt";
      case "product_sku": return "e.g., SKU-001";
      case "product_tag": return "e.g., sale";
      case "product_type": return "e.g., Electronics";
      case "product_vendor": return "e.g., Apple";
      case "item_price": return "e.g., 25.00";
      case "customer_email": return "e.g., customer@example.com";
      default: return "Enter value...";
    }
  };

  // Validation checks
  const hasEmptyConditions = conditions.some(c => !c.value.trim());
  const isDirty = name !== policy.name ||
    description !== (policy.description || "") ||
    priority !== String(policy.priority) ||
    outcomeAction !== existingOutcome.action ||
    outcomeMessage !== (existingOutcome.message || "") ||
    String(outcomeWindowDays) !== String(existingOutcome.returnWindowDays || "") ||
    JSON.stringify(manualReviewReasonIds.sort()) !== JSON.stringify((existingOutcome.manualReviewReasonIds || []).sort()) ||
    JSON.stringify(conditions) !== JSON.stringify(existingConditions);

  // Bug #266 Fix: Track isDirty with ref to avoid stale closure
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Warn on navigation if there are unsaved changes
  useBeforeUnload(
    useCallback(
      (event) => {
        if (isDirtyRef.current) {
          event.preventDefault();
        }
      },
      []
    )
  );

  const blocker = useBlocker(isDirty && navigation.state === "idle");

  return (
    <Page
      backAction={{ content: "Policies", url: "/app/policies" }}
      title={`Edit: ${policy.name}`}
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
                  <TextField
                    label="Name"
                    name="name"
                    value={name}
                    onChange={setName}
                    onBlur={() => setNameError(!name.trim() ? "Name is required" : "")}
                    error={nameError}
                    autoComplete="off"
                    requiredIndicator
                  />
                  <TextField label="Description" name="description" value={description} onChange={setDescription} autoComplete="off" multiline={2} />
                  <TextField
                    label="Priority"
                    name="priority"
                    type="number"
                    value={priority}
                    onChange={setPriority}
                    autoComplete="off"
                    helpText="Higher priority policies are evaluated first (0 = lowest, 100 = highest)."
                  />
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

                  <input type="hidden" name="conditionCount" value={conditions.length} />

                  {conditions.map((condition, index) => (
                    <Box key={index} background="bg-surface-secondary" padding="300" borderRadius="200">
                      {condition.field === "return_reason" ? (
                        <BlockStack gap="200">
                          <InlineStack gap="200" blockAlign="end" wrap={false}>
                            <div style={{ flex: 1 }}>
                              <Select
                                label="Field"
                                name={`condition_${index}_field`}
                                options={FIELD_OPTIONS}
                                value={condition.field}
                                onChange={(v) => {
                                  updateConditionState(index, "field", v);
                                  if (v !== "return_reason") {
                                    updateConditionState(index, "operator", "equals");
                                    updateConditionState(index, "value", "");
                                  }
                                }}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <Text as="p" variant="bodySm" tone="subdued">Matches any of the selected reasons</Text>
                            </div>
                            {conditions.length > 1 && (
                              <Button
                                tone="critical"
                                size="slim"
                                onClick={() => removeCondition(index)}
                                accessibilityLabel={`Remove condition ${index + 1}`}
                              >
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
                                      updateConditionState(index, "value", updated.join(","));
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
                      <InlineStack gap="200" blockAlign="end" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <Select
                            label="Field"
                            name={`condition_${index}_field`}
                            options={FIELD_OPTIONS}
                            value={condition.field}
                            onChange={(v) => {
                              updateConditionState(index, "field", v);
                              if (v === "return_reason") {
                                updateConditionState(index, "operator", "in");
                                updateConditionState(index, "value", "");
                              }
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <Select label="Operator" name={`condition_${index}_operator`} options={OPERATOR_OPTIONS} value={condition.operator} onChange={(v) => updateConditionState(index, "operator", v)} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Value"
                            name={`condition_${index}_value`}
                            value={condition.value}
                            onChange={(v) => updateConditionState(index, "value", v)}
                            placeholder={getValuePlaceholder(condition.field)}
                            autoComplete="off"
                          />
                        </div>
                        {conditions.length > 1 && (
                          <Button
                            tone="critical"
                            size="slim"
                            onClick={() => removeCondition(index)}
                            accessibilityLabel={`Remove condition ${index + 1}`}
                          >
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
                    <Select label="Action" name="outcomeAction" options={ACTION_OPTIONS} value={outcomeAction} onChange={(selected) => setOutcomeAction(selected as PolicyOutcome["action"])} />
                    <TextField
                      label="Message"
                      name="outcomeMessage"
                      value={outcomeMessage}
                      onChange={setOutcomeMessage}
                      autoComplete="off"
                      multiline={2}
                      helpText="Optional message shown to the customer when this policy matches."
                    />
                    {outcomeAction === "OVERRIDE_WINDOW" && (
                      <TextField label="Return window (days)" name="outcomeWindowDays" type="number" value={outcomeWindowDays} onChange={setOutcomeWindowDays} autoComplete="off" />
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
                  disabled={isSaving || !isDirty || !name.trim() || conditions.length === 0 || hasEmptyConditions}
                >
                  Save Changes
                </Button>
              </InlineStack>
            </div>
          </Layout.Section>
        </Layout>
      </Form>

      {/* Unsaved changes modal */}
      {blocker.state === "blocked" && (
        <Modal
          open
          onClose={() => blocker.reset?.()}
          title="Unsaved changes"
          primaryAction={{
            content: "Leave page",
            destructive: true,
            onAction: () => blocker.proceed?.()
          }}
          secondaryActions={[
            { content: "Stay", onAction: () => blocker.reset?.() }
          ]}
        >
          <Modal.Section>
            <p>You have unsaved changes. Are you sure you want to leave?</p>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
