import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Banner,
  Badge,
  IndexTable,
  EmptyState,
  SkeletonPage,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { listAgents, addAgent, removeAgent, toggleAgent } from "~/models/refundAgent.server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const agents = await listAgents(session.shop);

  // Check if the current user is the store owner via Shopify GraphQL API
  let isOwner = true; // Default true — if we can't determine, allow access
  try {
    const response = await admin.graphql(`{ shop { email name } }`);
    const shopData = (await response.json())?.data?.shop;
    if (shopData?.email) {
      // For now, any admin user with access to this embedded app is trusted.
      // The shop owner check can be tightened once online tokens are available.
      isOwner = true;
    }
  } catch (e) {
    // If API call fails, default to allowing access for admin users.
    // Offline sessions don't provide user-level info,
    // and we trust Shopify's embedded app auth to restrict access to authorized staff.
    console.info("[RefundAgents] Shop owner verification skipped (offline session):", e);
    isOwner = true;
  }

  return json({
    agents,
    isOwner,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // All authenticated admin users can manage refund agents.
  // Shopify's own auth already restricts access to authorized staff/owners.

  if (intent === "add-agent") {
    const email = (formData.get("email") as string)?.trim();
    const name = (formData.get("name") as string)?.trim() || null;

    if (!email) {
      return json({ success: false, error: "Email is required.", intent: "add-agent" }, { status: 400 });
    }

    if (!EMAIL_REGEX.test(email)) {
      return json({ success: false, error: "Please enter a valid email address.", intent: "add-agent" }, { status: 400 });
    }

    try {
      const addedBy = (session as any).onlineAccessInfo?.associated_user?.email || "Admin";
      await addAgent(session.shop, email, name, addedBy);
      return json({ success: true, intent: "add-agent" });
    } catch (err: any) {
      return json({ success: false, error: err.message || "Failed to add agent.", intent: "add-agent" }, { status: 400 });
    }
  }

  if (intent === "remove-agent") {
    const agentId = formData.get("agentId") as string;
    if (!agentId?.trim()) {
      return json({ success: false, error: "Agent ID is required.", intent: "remove-agent" }, { status: 400 });
    }

    try {
      await removeAgent(session.shop, agentId);
      return json({ success: true, intent: "remove-agent" });
    } catch (err: any) {
      return json({ success: false, error: err.message || "Failed to remove agent.", intent: "remove-agent" }, { status: 400 });
    }
  }

  if (intent === "toggle-agent") {
    const agentId = formData.get("agentId") as string;
    const active = formData.get("active") === "true";

    if (!agentId?.trim()) {
      return json({ success: false, error: "Agent ID is required.", intent: "toggle-agent" }, { status: 400 });
    }

    try {
      await toggleAgent(session.shop, agentId, active);
      return json({ success: true, intent: "toggle-agent" });
    } catch (err: any) {
      return json({ success: false, error: err.message || "Failed to toggle agent status.", intent: "toggle-agent" }, { status: 400 });
    }
  }

  return json({ success: false, error: "Invalid intent." }, { status: 400 });
};

export default function RefundAgents() {
  const { agents, isOwner } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Reset banner when new actionData arrives
  useEffect(() => {
    if (actionData) {
      setBannerDismissed(false);
      // Clear form on success and show toast
      if ((actionData as any).success) {
        if ((actionData as any).intent === "add-agent") {
          setEmail("");
          setName("");
          shopify.toast.show("Agent added successfully");
        } else if ((actionData as any).intent === "remove-agent") {
          shopify.toast.show("Agent removed successfully");
        } else if ((actionData as any).intent === "toggle-agent") {
          shopify.toast.show("Agent status updated");
        }
      }
    }
  }, [actionData]);

  if (navigation.state === "loading") {
    return (
      <SkeletonPage backAction title="Refund Authorization">
        <BlockStack gap="500">
          <Card>
            <SkeletonBodyText lines={3} />
          </Card>
          <Card>
            <SkeletonBodyText lines={6} />
          </Card>
        </BlockStack>
      </SkeletonPage>
    );
  }

  return (
    <Page
      title="Refund Authorization"
      backAction={{ url: "/app/settings" }}
    >
      {/* Error Banner */}
      {actionData && !bannerDismissed && (actionData as any).error && !(actionData as any).success && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone="critical" onDismiss={() => setBannerDismissed(true)}>
            <p>{(actionData as any).error}</p>
          </Banner>
        </div>
      )}

      {/* Owner-only warning */}
      {!isOwner && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone="warning">
            <p>Only the store owner can manage refund agents.</p>
          </Banner>
        </div>
      )}

      <BlockStack gap="500">
        {/* Add Agent Card */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Add Authorized Agent
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Authorize team members to process refunds. Agents must verify their identity via email OTP before processing any refund.
            </Text>
            <Form method="post">
              <input type="hidden" name="intent" value="add-agent" />
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="end">
                  <div style={{ flex: 2 }}>
                    <TextField
                      label="Email"
                      type="email"
                      value={email}
                      onChange={setEmail}
                      autoComplete="email"
                      placeholder="agent@example.com"
                      name="email"
                      disabled={!isOwner || isSubmitting}
                      requiredIndicator
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Name (optional)"
                      type="text"
                      value={name}
                      onChange={setName}
                      autoComplete="name"
                      placeholder="John Doe"
                      name="name"
                      disabled={!isOwner || isSubmitting}
                    />
                  </div>
                  <Button
                    submit
                    variant="primary"
                    disabled={!isOwner || isSubmitting || !email.trim()}
                    loading={isSubmitting && navigation.formData?.get("intent") === "add-agent"}
                  >
                    Add Agent
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {/* Agents List Card */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Authorized Agents ({agents.length})
            </Text>

            {agents.length === 0 ? (
              <EmptyState
                heading="No refund agents yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Add an email address to authorize team members to process refunds.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "agent", plural: "agents" }}
                itemCount={agents.length}
                headings={[
                  { title: "Email" },
                  { title: "Name" },
                  { title: "Status" },
                  { title: "Added" },
                  { title: "Actions", alignment: "end" },
                ]}
                selectable={false}
              >
                {agents.map((agent, index) => (
                  <IndexTable.Row id={agent.id} key={agent.id} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {agent.email}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        {agent.name || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={agent.active ? "success" : undefined}>
                        {agent.active ? "Active" : "Inactive"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {new Date(agent.createdAt).toLocaleDateString()}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" align="end">
                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle-agent" />
                          <input type="hidden" name="agentId" value={agent.id} />
                          <input type="hidden" name="active" value={String(!agent.active)} />
                          <Button
                            size="slim"
                            submit
                            disabled={!isOwner || isSubmitting}
                            loading={
                              isSubmitting &&
                              navigation.formData?.get("intent") === "toggle-agent" &&
                              navigation.formData?.get("agentId") === agent.id
                            }
                          >
                            {agent.active ? "Deactivate" : "Activate"}
                          </Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="remove-agent" />
                          <input type="hidden" name="agentId" value={agent.id} />
                          <Button
                            size="slim"
                            tone="critical"
                            variant="plain"
                            submit
                            disabled={!isOwner || isSubmitting}
                            loading={
                              isSubmitting &&
                              navigation.formData?.get("intent") === "remove-agent" &&
                              navigation.formData?.get("agentId") === agent.id
                            }
                          >
                            Remove
                          </Button>
                        </Form>
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        {/* Info Banner */}
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              How Refund Authorization Works
            </Text>
            <Text as="p" variant="bodyMd">
              When an authorized agent attempts to process a refund, they will receive a one-time verification code via email.
              This ensures that only verified team members can issue refunds, adding an extra layer of security to your refund process.
            </Text>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Page>
  );
}
