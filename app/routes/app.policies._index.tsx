import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  InlineStack,
  EmptyState,
  Modal,
  BlockStack,
  SkeletonPage,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { listPolicies, deletePolicy } from "~/models/returnPolicy.server";
import type { PolicyType } from "@prisma/client";

const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  ELIGIBILITY: "Eligibility",
  AUTO_ACTION: "Auto Action",
  EXCLUSION: "Exclusion",
  REQUIREMENT: "Requirement",
};

const POLICY_TYPE_TONES: Record<PolicyType, "info" | "success" | "warning" | "critical"> = {
  ELIGIBILITY: "info",
  AUTO_ACTION: "success",
  EXCLUSION: "critical",
  REQUIREMENT: "warning",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const policies = await listPolicies(session.shop);
  return json({ policies });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "delete") {
    const policyId = formData.get("policyId") as string;
    const policy = await import("~/models/returnPolicy.server").then(m => m.getPolicy(policyId, session.shop));
    if (policy) {
      await deletePolicy(policyId, session.shop);
    }
    return json({ success: true });
  }

  if (intent === "toggle") {
    const policyId = formData.get("policyId") as string;
    const active = formData.get("active") === "true";
    const { updatePolicy } = await import("~/models/returnPolicy.server");
    const policy = await import("~/models/returnPolicy.server").then(m => m.getPolicy(policyId, session.shop));
    if (policy) {
      await updatePolicy(policyId, session.shop, { active: !active });
    }
    return json({ success: true });
  }

  return json({ success: false }, { status: 400 });
};

export default function PoliciesList() {
  const { policies } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();

  const toggleFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingPolicy, setDeletingPolicy] = useState<{ id: string; name: string } | null>(null);

  const [toggleModalOpen, setToggleModalOpen] = useState(false);
  const [togglingPolicy, setTogglingPolicy] = useState<{ id: string; name: string; active: boolean; type: PolicyType } | null>(null);

  const handleDelete = useCallback((id: string, name: string) => {
    setDeletingPolicy({ id, name });
    setDeleteModalOpen(true);
  }, []);

  const handleToggle = useCallback((id: string, name: string, active: boolean, type: PolicyType) => {
    setTogglingPolicy({ id, name, active, type });
    setToggleModalOpen(true);
  }, []);

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data && deleteModalOpen) {
      if ((deleteFetcher.data as any).success) {
        setDeleteModalOpen(false);
        setDeletingPolicy(null);
        shopify.toast.show("Policy deleted");
      }
    }
  }, [deleteFetcher.state, deleteFetcher.data, deleteModalOpen]);

  useEffect(() => {
    if (toggleFetcher.state === "idle" && toggleFetcher.data && toggleModalOpen) {
      if ((toggleFetcher.data as any).success) {
        setToggleModalOpen(false);
        setTogglingPolicy(null);
        shopify.toast.show("Policy updated");
      }
    }
  }, [toggleFetcher.state, toggleFetcher.data, toggleModalOpen]);

  if (navigation.state === "loading") {
    return (
      <SkeletonPage title="Return Policies" primaryAction>
        <Card>
          <SkeletonBodyText lines={6} />
        </Card>
      </SkeletonPage>
    );
  }

  return (
    <Page
      title="Return Policies"
      primaryAction={{
        content: "Create policy",
        onAction: () => navigate("/app/policies/new"),
      }}
    >
      {policies.length === 0 ? (
        <Card>
          <EmptyState
            heading="No return policies"
            action={{ content: "Create policy", onAction: () => navigate("/app/policies/new") }}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Create policies to control return eligibility, auto-approve rules, product exclusions, and more.</p>
          </EmptyState>
        </Card>
      ) : (
        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "policy", plural: "policies" }}
            itemCount={policies.length}
            headings={[
              { title: "Name" },
              { title: "Type" },
              { title: "Priority (higher = first)" },
              { title: "Status" },
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {policies.map((policy, index) => (
              <IndexTable.Row
                id={policy.id}
                key={policy.id}
                position={index}
              >
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {policy.name}
                  </Text>
                  {policy.description && (
                    <div>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {policy.description}
                      </Text>
                    </div>
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={POLICY_TYPE_TONES[policy.type as PolicyType]}>
                    {POLICY_TYPE_LABELS[policy.type as PolicyType]}
                  </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">{policy.priority}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Button
                    size="slim"
                    variant={policy.active ? "primary" : "plain"}
                    loading={toggleFetcher.state !== "idle" && togglingPolicy?.id === policy.id}
                    onClick={() => handleToggle(policy.id, policy.name, policy.active, policy.type as PolicyType)}
                  >
                    {policy.active ? "Active" : "Inactive"}
                  </Button>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200">
                    <Button size="slim" onClick={() => navigate(`/app/policies/${policy.id}`)}>
                      Edit
                    </Button>
                    <Button size="slim" tone="critical" onClick={() => handleDelete(policy.id, policy.name)}>
                      Delete
                    </Button>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      )}

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete policy?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: deleteFetcher.state !== "idle",
          onAction: () => {
            if (deletingPolicy) {
              const formData = new FormData();
              formData.append("intent", "delete");
              formData.append("policyId", deletingPolicy.id);
              deleteFetcher.submit(formData, { method: "post" });
            }
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteModalOpen(false) }]}
      >
        <Modal.Section>
          <p>This policy will be permanently deleted. This action cannot be undone.</p>
        </Modal.Section>
      </Modal>

      <Modal
        open={toggleModalOpen}
        onClose={() => setToggleModalOpen(false)}
        title={togglingPolicy?.active ? "Deactivate policy?" : "Activate policy?"}
        primaryAction={{
          content: togglingPolicy?.active ? "Deactivate" : "Activate",
          loading: toggleFetcher.state !== "idle",
          onAction: () => {
            if (togglingPolicy) {
              const formData = new FormData();
              formData.append("intent", "toggle");
              formData.append("policyId", togglingPolicy.id);
              formData.append("active", String(togglingPolicy.active));
              toggleFetcher.submit(formData, { method: "post" });
            }
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setToggleModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <p>
              Are you sure you want to {togglingPolicy?.active ? "deactivate" : "activate"} the policy "{togglingPolicy?.name}"?
            </p>
            {togglingPolicy && (
              <div>
                <Badge tone={POLICY_TYPE_TONES[togglingPolicy.type]}>
                  {POLICY_TYPE_LABELS[togglingPolicy.type]}
                </Badge>
              </div>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
