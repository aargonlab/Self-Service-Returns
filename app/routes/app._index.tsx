import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  InlineGrid,
  ResourceList,
  ResourceItem,
  Banner,
  SkeletonPage,
  SkeletonBodyText,
  SkeletonDisplayText,
  Layout,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import {
  getReturnRequestCountsByStatus,
  listReturnRequests,
} from "~/models/returnRequest.server";
import type { ReturnStatus } from "@prisma/client";
import { ReturnStatusBadge } from "~/components/admin/ReturnStatusBadge";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const [statusCounts, recentReturns] = await Promise.all([
      getReturnRequestCountsByStatus(shop),
      listReturnRequests({ shop, page: 1, pageSize: 5 }),
    ]);

    const totalOpen = ["SUBMITTED", "PENDING_REVIEW", "APPROVED", "AWAITING_SHIPMENT", "IN_TRANSIT", "RECEIVED"]
      .reduce((sum, s) => sum + (statusCounts[s] || 0), 0);

    const actionRequired = ["SUBMITTED", "PENDING_REVIEW", "RECEIVED"]
      .reduce((sum, s) => sum + (statusCounts[s] || 0), 0);

    const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "";
    if (!appUrl) {
      console.warn("[App] No SHOPIFY_APP_URL or APP_URL configured — portal links may not work");
    }
    const portalUrl = appUrl ? `${appUrl}/returns?shop=${shop}` : "";

    return json({
      statusCounts,
      recentReturns: recentReturns.items,
      totalOpen,
      actionRequired,
      portalUrl,
      loadError: null as string | null,
    });
  } catch (error) {
    console.error("Dashboard loader error:", error);
    return json({
      statusCounts: {} as Record<string, number>,
      recentReturns: [] as any[],
      totalOpen: 0,
      actionRequired: 0,
      portalUrl: "",
      loadError: "Failed to load dashboard data. Please refresh the page.",
    });
  }
};

const DASHBOARD_STYLES = `
  .status-badge-link:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }
`;

export default function Dashboard() {
  const navigation = useNavigation();
  const { statusCounts, recentReturns, totalOpen, actionRequired, portalUrl, loadError } =
    useLoaderData<typeof loader>();

  if (navigation.state === "loading") {
    return (
      <SkeletonPage primaryAction title="">
        <Layout>
          <Layout.Section>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <Card>
                <BlockStack gap="200">
                  <SkeletonBodyText lines={1} />
                  <SkeletonDisplayText size="small" />
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <SkeletonBodyText lines={1} />
                  <SkeletonDisplayText size="small" />
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <SkeletonBodyText lines={1} />
                  <SkeletonDisplayText size="small" />
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <SkeletonBodyText lines={1} />
                  <SkeletonDisplayText size="small" />
                </BlockStack>
              </Card>
            </InlineGrid>
            <Card>
              <SkeletonBodyText lines={3} />
            </Card>
            <Card>
              <BlockStack gap="300">
                <SkeletonBodyText lines={1} />
                <SkeletonBodyText lines={2} />
                <SkeletonBodyText lines={2} />
                <SkeletonBodyText lines={2} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  return (
    <Page title="Dashboard">
      <style>{DASHBOARD_STYLES}</style>
      <BlockStack gap="500">
        {loadError && (
          <Banner tone="critical">
            <p>{loadError}</p>
          </Banner>
        )}
        {/* Summary Cards */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Action Required</Text>
              <Text as="p" variant="headingXl">{actionRequired}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Open Returns</Text>
              <Text as="p" variant="headingXl">{totalOpen}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Pending Review</Text>
              <Text as="p" variant="headingXl">
                {(statusCounts["SUBMITTED"] || 0) + (statusCounts["PENDING_REVIEW"] || 0)}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Refunded</Text>
              <Text as="p" variant="headingXl">{statusCounts["REFUNDED"] || 0}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Status Breakdown */}
        {Object.keys(statusCounts).length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Returns by Status</Text>
              <InlineStack gap="300" wrap>
                {Object.entries(statusCounts).map(([status, count]) => (
                  <Link
                    key={status}
                    to={`/app/returns?status=${status}`}
                    style={{ textDecoration: "none" }}
                  >
                    <div style={{ padding: "4px 8px", borderRadius: "8px", transition: "background-color 0.15s" }} className="status-badge-link">
                      <InlineStack gap="100" blockAlign="center">
                        <ReturnStatusBadge status={status as ReturnStatus} />
                        <Text as="span" variant="bodyMd">{count as number}</Text>
                      </InlineStack>
                    </div>
                  </Link>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Recent Returns */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Recent Returns</Text>
              <Link to="/app/returns">
                <Text as="span" variant="bodyMd" tone="magic">View all</Text>
              </Link>
            </InlineStack>

            {recentReturns.length === 0 ? (
              <EmptyState
                heading="No return requests yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Share your return portal link with customers to get started.</p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "return", plural: "returns" }}
                items={recentReturns}
                renderItem={(item) => {
                  const { id, shopifyOrderName, customerName, customerEmail, status, createdAt, items: returnItems } = item;
                  return (
                    <ResourceItem
                      id={id}
                      url={`/app/returns/${id}`}
                      accessibilityLabel={`View return for order ${shopifyOrderName}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {shopifyOrderName}
                            </Text>
                            <ReturnStatusBadge status={status as ReturnStatus} />
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {customerName} ({customerEmail})
                          </Text>
                        </BlockStack>
                        <BlockStack gap="100" inlineAlign="end">
                          <Text as="span" variant="bodySm" tone="subdued">
                            {returnItems.length} item{returnItems.length !== 1 ? "s" : ""}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            )}
          </BlockStack>
        </Card>

        {/* Portal Link */}
        {portalUrl && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Customer Return Portal</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Share this link with your customers so they can submit return requests:
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  {portalUrl}
                </Text>
              </Box>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
