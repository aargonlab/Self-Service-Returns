import { Page, Layout, Card, Text, Badge, Box, InlineStack, BlockStack, Divider, Banner, Collapsible } from "@shopify/polaris";
import { useState } from "react";

export default function ApiDocsPage() {
  const [openSections, setOpenSections] = useState<{ [key: string]: boolean }>({});

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Page
      title="API Documentation"
      subtitle="Complete reference for the SelfServiceReturn REST API"
      backAction={{ url: "/app/settings" }}
    >
      <Layout>
        {/* Overview Banner */}
        <Layout.Section>
          <Banner tone="info">
            <p>
              This REST API allows you to programmatically manage returns and execute actions.
              Settings are read-only via the API and can only be modified through the Shopify admin UI.
              All endpoints require API key authentication.
            </p>
          </Banner>
        </Layout.Section>

        {/* Authentication */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Authentication</Text>
              <Text as="p" variant="bodyMd">
                All API requests require two headers for authentication and shop identification:
              </Text>
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="bold">Required Headers:</Text>
                  <Box paddingInlineStart="400">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm">
                        <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                          Authorization: Bearer ssr_live_xxxxxxxxxxxx
                        </span>
                      </Text>
                      <Text as="p" variant="bodySm">
                        <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                          X-Shop-Domain: your-store.myshopify.com
                        </span>
                      </Text>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">
                The Bearer prefix is case-insensitive.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                You can create and manage API keys in <strong>Settings → API Keys</strong>. Each key has specific scopes that control access to different endpoints.
              </Text>
              <Divider />
              <Text as="h3" variant="headingSm">CORS Policy</Text>
              <Text as="p" variant="bodySm">
                API requests are only allowed from Shopify domains. Cross-origin requests from other domains will be rejected.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Quick Start */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Quick Start</Text>
              <BlockStack gap="300">
                <InlineStack gap="200" align="start">
                  <Box minWidth="24px">
                    <Badge tone="info">1</Badge>
                  </Box>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">Create an API Key</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Go to Settings → API Keys and create a new key with the scopes you need (e.g., <code>returns:read</code>, <code>returns:write</code>).
                    </Text>
                  </BlockStack>
                </InlineStack>

                <InlineStack gap="200" align="start">
                  <Box minWidth="24px">
                    <Badge tone="info">2</Badge>
                  </Box>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">Make Your First Request</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Test your API key by listing returns:
                    </Text>
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <Text as="p" variant="bodySm">
                        <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                          curl -X GET "https://your-app.myshopify.com/api/v1/returns" \<br />
                          &nbsp;&nbsp;-H "Authorization: Bearer ssr_live_xxxxxxxxxxxx" \<br />
                          &nbsp;&nbsp;-H "X-Shop-Domain: your-store.myshopify.com"
                        </span>
                      </Text>
                    </Box>
                  </BlockStack>
                </InlineStack>

                <InlineStack gap="200" align="start">
                  <Box minWidth="24px">
                    <Badge tone="info">3</Badge>
                  </Box>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">Explore Endpoints</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Browse the endpoint reference below to discover all available operations.
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Endpoints Reference */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Endpoints Reference</Text>

              {/* GET /api/v1/returns */}
              <Box>
                <div onClick={() => toggleSection("list-returns")} style={{ cursor: 'pointer' }}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge tone="success">GET</Badge>
                    <Text as="span" variant="bodyMd"><span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>/api/v1/returns</span></Text>
                    <Text as="span" variant="bodySm" tone="subdued">— List returns</Text>
                    <Box paddingInlineStart="200">
                      <Text as="span" variant="bodySm" tone="subdued">{openSections["list-returns"] ? "▲" : "▼"}</Text>
                    </Box>
                  </InlineStack>
                </div>
                <Collapsible open={openSections["list-returns"] || false} id="list-returns">
                  <Box paddingBlockStart="300" paddingInlineStart="400">
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Scope:</Text>
                        <Badge tone="info">returns:read</Badge>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Description:</Text>
                        <Text as="p" variant="bodySm">List returns with filtering and pagination.</Text>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Query Parameters:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <BlockStack gap="200">
                            <div><code>status</code> — Filter by status. Supports single value (e.g., <code>SUBMITTED</code>) or comma-separated multiple values (e.g., <code>IN_TRANSIT,AWAITING_SHIPMENT</code>). Optional.</div>
                            <div><code>resolutionType</code> — Filter by resolution type: <code>REFUND</code> or <code>EXCHANGE</code>. Optional.</div>
                            <div><code>search</code> — Search by order name, customer name/email. Max 200 characters. Optional.</div>
                            <div><code>dateFrom</code> — ISO date filter for start date. Optional.</div>
                            <div><code>dateTo</code> — ISO date filter for end date. Optional.</div>
                            <div><code>page</code> — Page number, must be &gt;= 1. Default 1.</div>
                            <div><code>pageSize</code> — Items per page, must be between 1 and 100. Default 20.</div>
                          </BlockStack>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Example Request:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <Text as="p" variant="bodySm">
                            <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                              curl -X GET "https://your-app.myshopify.com/api/v1/returns?status=SUBMITTED&amp;page=1&amp;pageSize=20" \<br />
                              &nbsp;&nbsp;-H "Authorization: Bearer ssr_live_xxxxxxxxxxxx" \<br />
                              &nbsp;&nbsp;-H "X-Shop-Domain: your-store.myshopify.com"
                            </span>
                          </Text>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Response (200 OK):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "items": [
    {
      "id": "clxabc123def456ghi",
      "shopifyOrderId": "gid://shopify/Order/6073200001234",
      "shopifyOrderName": "#1042",
      "shopifyReturnId": "gid://shopify/Return/123456789",
      "customerEmail": "customer@example.com",
      "customerName": "John Doe",
      "shop": "your-store.myshopify.com",
      "status": "SUBMITTED",
      "resolutionType": "RETURN",
      "returnWindow": 30,
      "marketId": "gid://shopify/Market/12345",
      "windowOverride": null,
      "requireManualApproval": false,
      "notes": null,
      "createdAt": "2026-03-10T14:30:00.000Z",
      "updatedAt": "2026-03-10T14:30:00.000Z",
      "closedAt": null,
      "items": [
        {
          "id": "clxitem001",
          "returnRequestId": "clxabc123def456ghi",
          "shopifyLineItemId": "gid://shopify/LineItem/98765",
          "shopifyVariantId": "gid://shopify/ProductVariant/44001234",
          "productTitle": "Classic T-Shirt",
          "variantTitle": "Blue / M",
          "sku": "TSH-BLU-M",
          "imageUrl": "https://cdn.shopify.com/...",
          "price": "29.99",
          "quantity": 1,
          "returnReason": "DOESNT_FIT",
          "compositeCode": "RET-DOESNT_FIT",
          "customerNote": "Too small",
          "serialNumber": null
        }
      ]
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}`}</pre>
                        </Box>
                      </div>
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>

              <Divider />

              {/* GET /api/v1/returns/:id */}
              <Box>
                <div onClick={() => toggleSection("get-return")} style={{ cursor: 'pointer' }}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge tone="success">GET</Badge>
                    <Text as="span" variant="bodyMd"><span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>/api/v1/returns/:id</span></Text>
                    <Text as="span" variant="bodySm" tone="subdued">— Get return details</Text>
                    <Box paddingInlineStart="200">
                      <Text as="span" variant="bodySm" tone="subdued">{openSections["get-return"] ? "▲" : "▼"}</Text>
                    </Box>
                  </InlineStack>
                </div>
                <Collapsible open={openSections["get-return"] || false} id="get-return">
                  <Box paddingBlockStart="300" paddingInlineStart="400">
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Scope:</Text>
                        <Badge tone="info">returns:read</Badge>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Description:</Text>
                        <Text as="p" variant="bodySm">Get return details including items, comments (non-internal), and timeline.</Text>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Path Parameters:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <BlockStack gap="200">
                            <div><code>id</code> — Return ID (required). Accepts three formats:</div>
                            <Box paddingInlineStart="400">
                              <BlockStack gap="100">
                                <div>&#8226; Internal ID (CUID format, e.g., <code>clxabc123def456ghi</code>)</div>
                                <div>&#8226; Shopify return GID (e.g., <code>gid://shopify/Return/123456789</code>)</div>
                                <div>&#8226; Shopify return numeric ID (e.g., <code>123456789</code> — auto-expanded to full GID)</div>
                              </BlockStack>
                            </Box>
                          </BlockStack>
                        </Box>
                      </div>
                      <Banner tone="info">
                        <p>
                          <strong>Shopify correlation:</strong> If you receive a Shopify webhook with a return ID (e.g., from <code>returns/create</code>),
                          you can pass that ID directly to this endpoint to look up the corresponding return in our system.
                        </p>
                      </Banner>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Example — Lookup by internal ID:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <Text as="p" variant="bodySm">
                            <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                              curl -X GET "https://your-app.myshopify.com/api/v1/returns/clxabc123def456ghi" \<br />
                              &nbsp;&nbsp;-H "Authorization: Bearer ssr_live_xxxxxxxxxxxx" \<br />
                              &nbsp;&nbsp;-H "X-Shop-Domain: your-store.myshopify.com"
                            </span>
                          </Text>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Example — Lookup by Shopify numeric ID:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <Text as="p" variant="bodySm">
                            <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                              curl -X GET "https://your-app.myshopify.com/api/v1/returns/123456789" \<br />
                              &nbsp;&nbsp;-H "Authorization: Bearer ssr_live_xxxxxxxxxxxx" \<br />
                              &nbsp;&nbsp;-H "X-Shop-Domain: your-store.myshopify.com"
                            </span>
                          </Text>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Response (200 OK):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "id": "clxabc123def456ghi",
  "shopifyOrderId": "gid://shopify/Order/6073200001234",
  "shopifyOrderName": "#1042",
  "shopifyReturnId": "gid://shopify/Return/123456789",
  "customerEmail": "customer@example.com",
  "customerName": "John Doe",
  "shop": "your-store.myshopify.com",
  "status": "APPROVED",
  "resolutionType": "RETURN",
  "returnWindow": 30,
  "marketId": "gid://shopify/Market/12345",
  "windowOverride": null,
  "requireManualApproval": false,
  "notes": null,
  "createdAt": "2026-03-10T14:30:00.000Z",
  "updatedAt": "2026-03-11T09:15:00.000Z",
  "closedAt": null,
  "items": [
    {
      "id": "clxitem001",
      "returnRequestId": "clxabc123def456ghi",
      "shopifyLineItemId": "gid://shopify/LineItem/98765",
      "shopifyVariantId": "gid://shopify/ProductVariant/44001234",
      "productTitle": "Classic T-Shirt",
      "variantTitle": "Blue / M",
      "sku": "TSH-BLU-M",
      "imageUrl": "https://cdn.shopify.com/...",
      "price": "29.99",
      "quantity": 1,
      "returnReason": "DOESNT_FIT",
      "compositeCode": "RET-DOESNT_FIT",
      "customerNote": "Too small",
      "serialNumber": null,
      "attachments": []
    }
  ],
  "comments": [
    {
      "id": "clxcmt001",
      "content": "We approved your return, please ship it back.",
      "author": "Support Team",
      "isInternal": false,
      "createdAt": "2026-03-11T09:15:00.000Z"
    }
  ],
  "timeline": [
    {
      "id": "clxtl002",
      "event": "STATUS_CHANGE",
      "fromStatus": "SUBMITTED",
      "toStatus": "APPROVED",
      "actor": "Support Team",
      "actorType": "AGENT",
      "details": null,
      "createdAt": "2026-03-11T09:15:00.000Z"
    },
    {
      "id": "clxtl001",
      "event": "RETURN_CREATED",
      "fromStatus": null,
      "toStatus": "SUBMITTED",
      "actor": "Customer",
      "actorType": "CUSTOMER",
      "details": null,
      "createdAt": "2026-03-10T14:30:00.000Z"
    }
  ],
  "replacementInstruction": null,
  "inspectionResults": [],
  "shippingLabel": {
    "id": "clxlbl001",
    "carrier": "Internal",
    "trackingNumber": "RET-a1b2c3d4",
    "barcode": "120394857612",
    "labelUrl": "/returns/clxabc123def456ghi/label"
  },
  "policyEvaluations": []
}`}</pre>
                        </Box>
                      </div>
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>

              <Divider />

              {/* POST /api/v1/returns/:id/actions */}
              <Box>
                <div onClick={() => toggleSection("execute-action")} style={{ cursor: 'pointer' }}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge>POST</Badge>
                    <Text as="span" variant="bodyMd"><span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>/api/v1/returns/:id/actions</span></Text>
                    <Text as="span" variant="bodySm" tone="subdued">— Execute action</Text>
                    <Box paddingInlineStart="200">
                      <Text as="span" variant="bodySm" tone="subdued">{openSections["execute-action"] ? "▲" : "▼"}</Text>
                    </Box>
                  </InlineStack>
                </div>
                <Collapsible open={openSections["execute-action"] || false} id="execute-action">
                  <Box paddingBlockStart="300" paddingInlineStart="400">
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Scope:</Text>
                        <Badge tone="warning">returns:write</Badge>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Description:</Text>
                        <Text as="p" variant="bodySm">Execute an action on a return (approve, reject, refund, etc.).</Text>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Request Body:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <BlockStack gap="200">
                            <div><code>action</code> (required) — Action to perform</div>
                            <div><code>reason</code> — Required for "reject" action (max 2000 characters)</div>
                            <div><code>notes</code> — Optional for "process_replacement" action (max 2000 characters)</div>
                            <div><code>status</code> — Required for "transition" action (e.g., IN_TRANSIT, RECEIVED)</div>
                            <div><code>actor</code> — Optional actor name, defaults to "API" (max 100 characters)</div>
                          </BlockStack>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Available Actions:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <BlockStack gap="100">
                            <div><code>approve</code> — Approve the return</div>
                            <div><code>reject</code> — Reject the return (requires <code>reason</code>)</div>
                            <div><code>cancel</code> — Cancel the return</div>
                            <div><code>process_refund</code> — Process refund to original payment method</div>
                            <div><code>process_replacement</code> — Process replacement order</div>
                            <div><code>transition</code> — Manually transition status (requires <code>status</code>)</div>
                          </BlockStack>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Example Request (Approve):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <Text as="p" variant="bodySm">
                            <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                              curl -X POST "https://your-app.myshopify.com/api/v1/returns/clx123abc/actions" \<br />
                              &nbsp;&nbsp;-H "Authorization: Bearer ssr_live_xxxxxxxxxxxx" \<br />
                              &nbsp;&nbsp;-H "X-Shop-Domain: your-store.myshopify.com" \<br />
                              &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
                              &nbsp;&nbsp;-d '{'{'}'"action": "approve", "actor": "Support Team"{'}'}'
                            </span>
                          </Text>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Example Request (Reject):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <Text as="p" variant="bodySm">
                            <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                              curl -X POST "https://your-app.myshopify.com/api/v1/returns/clx123abc/actions" \<br />
                              &nbsp;&nbsp;-H "Authorization: Bearer ssr_live_xxxxxxxxxxxx" \<br />
                              &nbsp;&nbsp;-H "X-Shop-Domain: your-store.myshopify.com" \<br />
                              &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
                              &nbsp;&nbsp;-d '{'{'}'"action": "reject", "reason": "Item not eligible for return"{'}'}'
                            </span>
                          </Text>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Response (200 OK):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "success": true,
  "message": "Return approved successfully",
  "returnRequest": {
    "id": "clxabc123def456ghi",
    "status": "APPROVED",
    "resolutionType": "RETURN",
    "customerEmail": "customer@example.com",
    "customerName": "John Doe",
    "shopifyOrderName": "#1042",
    "updatedAt": "2026-03-11T09:15:00.000Z",
    "closedAt": null,
    "items": ["..."],
    "comments": ["..."],
    "timeline": ["..."]
  }
}`}</pre>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Error Responses:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <BlockStack gap="300">
                            <div>
                              <Text as="p" variant="bodySm" fontWeight="semibold">409 Conflict — Invalid state transition:</Text>
                              <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "error": {
    "code": "CONFLICT",
    "message": "Invalid status transition from CLOSED to APPROVED"
  }
}`}</pre>
                            </div>
                            <div>
                              <Text as="p" variant="bodySm" fontWeight="semibold">400 Bad Request — Validation error:</Text>
                              <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "error": {
    "code": "BAD_REQUEST",
    "message": "'reason' is required for reject action"
  }
}`}</pre>
                            </div>
                          </BlockStack>
                        </Box>
                      </div>
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>

              <Divider />

              {/* GET /api/v1/returns/:id/comments */}
              <Box>
                <div onClick={() => toggleSection("get-comments")} style={{ cursor: 'pointer' }}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge tone="success">GET</Badge>
                    <Text as="span" variant="bodyMd"><span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>/api/v1/returns/:id/comments</span></Text>
                    <Text as="span" variant="bodySm" tone="subdued">— List comments</Text>
                    <Box paddingInlineStart="200">
                      <Text as="span" variant="bodySm" tone="subdued">{openSections["get-comments"] ? "▲" : "▼"}</Text>
                    </Box>
                  </InlineStack>
                </div>
                <Collapsible open={openSections["get-comments"] || false} id="get-comments">
                  <Box paddingBlockStart="300" paddingInlineStart="400">
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Scope:</Text>
                        <Badge tone="info">returns:read</Badge>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Description:</Text>
                        <Text as="p" variant="bodySm">List comments on a return.</Text>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Query Parameters:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <div><code>includeInternal</code> — Set to "true" to include internal notes (optional)</div>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Response (200 OK):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "comments": [
    {
      "id": "clxcmt001",
      "content": "Customer confirmed shipment tracking.",
      "author": "Support Team",
      "isInternal": false,
      "createdAt": "2026-03-11T09:15:00.000Z"
    }
  ]
}`}</pre>
                        </Box>
                      </div>
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>

              <Divider />

              {/* POST /api/v1/returns/:id/comments */}
              <Box>
                <div onClick={() => toggleSection("add-comment")} style={{ cursor: 'pointer' }}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge>POST</Badge>
                    <Text as="span" variant="bodyMd"><span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>/api/v1/returns/:id/comments</span></Text>
                    <Text as="span" variant="bodySm" tone="subdued">— Add comment</Text>
                    <Box paddingInlineStart="200">
                      <Text as="span" variant="bodySm" tone="subdued">{openSections["add-comment"] ? "▲" : "▼"}</Text>
                    </Box>
                  </InlineStack>
                </div>
                <Collapsible open={openSections["add-comment"] || false} id="add-comment">
                  <Box paddingBlockStart="300" paddingInlineStart="400">
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Scope:</Text>
                        <Badge tone="warning">returns:write</Badge>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Description:</Text>
                        <Text as="p" variant="bodySm">Add a comment to a return.</Text>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Request Body:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <BlockStack gap="200">
                            <div><code>content</code> (required) — Comment text</div>
                            <div><code>isInternal</code> — Boolean, default false</div>
                            <div><code>author</code> — Optional author name, defaults to "API"</div>
                          </BlockStack>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Example Request:</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <Text as="p" variant="bodySm">
                            <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                              curl -X POST "https://your-app.myshopify.com/api/v1/returns/clx123abc/comments" \<br />
                              &nbsp;&nbsp;-H "Authorization: Bearer ssr_live_xxxxxxxxxxxx" \<br />
                              &nbsp;&nbsp;-H "X-Shop-Domain: your-store.myshopify.com" \<br />
                              &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
                              &nbsp;&nbsp;-d '{'{'}'"content": "Customer confirmed shipment", "isInternal": true{'}'}'
                            </span>
                          </Text>
                        </Box>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Response (201 Created):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "success": true,
  "comment": {
    "id": "clxcmt002",
    "content": "Customer confirmed shipment",
    "author": "API",
    "isInternal": true,
    "createdAt": "2026-03-12T10:00:00.000Z"
  }
}`}</pre>
                        </Box>
                      </div>
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>

              <Divider />

              {/* GET /api/v1/returns/:id/timeline */}
              <Box>
                <div onClick={() => toggleSection("get-timeline")} style={{ cursor: 'pointer' }}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge tone="success">GET</Badge>
                    <Text as="span" variant="bodyMd"><span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>/api/v1/returns/:id/timeline</span></Text>
                    <Text as="span" variant="bodySm" tone="subdued">— Get timeline</Text>
                    <Box paddingInlineStart="200">
                      <Text as="span" variant="bodySm" tone="subdued">{openSections["get-timeline"] ? "▲" : "▼"}</Text>
                    </Box>
                  </InlineStack>
                </div>
                <Collapsible open={openSections["get-timeline"] || false} id="get-timeline">
                  <Box paddingBlockStart="300" paddingInlineStart="400">
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Scope:</Text>
                        <Badge tone="info">returns:read</Badge>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Description:</Text>
                        <Text as="p" variant="bodySm">Get timeline events for a return (status changes, actions, etc.).</Text>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Response (200 OK):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "timeline": [
    {
      "id": "clxtl002",
      "event": "STATUS_CHANGE",
      "fromStatus": "SUBMITTED",
      "toStatus": "APPROVED",
      "actor": "Support Team",
      "actorType": "AGENT",
      "details": null,
      "createdAt": "2026-03-11T09:15:00.000Z"
    }
  ]
}`}</pre>
                        </Box>
                      </div>
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>

              <Divider />

              {/* GET /api/v1/returns/:id/label */}
              <Box>
                <div onClick={() => toggleSection("get-label")} style={{ cursor: 'pointer' }}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge tone="success">GET</Badge>
                    <Text as="span" variant="bodyMd"><span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>/api/v1/returns/:id/label</span></Text>
                    <Text as="span" variant="bodySm" tone="subdued">— Get shipping label</Text>
                    <Box paddingInlineStart="200">
                      <Text as="span" variant="bodySm" tone="subdued">{openSections["get-label"] ? "▲" : "▼"}</Text>
                    </Box>
                  </InlineStack>
                </div>
                <Collapsible open={openSections["get-label"] || false} id="get-label">
                  <Box paddingBlockStart="300" paddingInlineStart="400">
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Scope:</Text>
                        <Badge tone="info">returns:read</Badge>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Description:</Text>
                        <Text as="p" variant="bodySm">Get shipping label for a return (if available).</Text>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Response (200 OK):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "label": {
    "id": "clxlbl001",
    "carrier": "Internal",
    "trackingNumber": "RET-a1b2c3d4",
    "barcode": "120394857612",
    "labelUrl": "/returns/clxabc123def456ghi/label",
    "createdAt": "2026-03-11T09:20:00.000Z"
  }
}`}</pre>
                        </Box>
                      </div>
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>

              <Divider />

              {/* GET /api/v1/settings */}
              <Box>
                <div onClick={() => toggleSection("get-settings")} style={{ cursor: 'pointer' }}>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge tone="success">GET</Badge>
                    <Text as="span" variant="bodyMd"><span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>/api/v1/settings</span></Text>
                    <Text as="span" variant="bodySm" tone="subdued">— Get settings</Text>
                    <Box paddingInlineStart="200">
                      <Text as="span" variant="bodySm" tone="subdued">{openSections["get-settings"] ? "▲" : "▼"}</Text>
                    </Box>
                  </InlineStack>
                </div>
                <Collapsible open={openSections["get-settings"] || false} id="get-settings">
                  <Box paddingBlockStart="300" paddingInlineStart="400">
                    <BlockStack gap="300">
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Scope:</Text>
                        <Badge tone="info">settings:read</Badge>
                      </div>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Description:</Text>
                        <Text as="p" variant="bodySm">Get return settings for the shop (read-only). Settings can only be modified through the Shopify admin UI.</Text>
                      </div>
                      <Banner tone="warning">
                        <p>
                          This endpoint is <strong>read-only</strong>. PUT, PATCH, and POST requests will return 405 Method Not Allowed with a JSON error body.
                        </p>
                      </Banner>
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="semibold">Response (200 OK):</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <pre style={{ fontFamily: "var(--p-font-family-mono, monospace)", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{`{
  "settings": {
    "returnWindowDays": 30,
    "allowedReasons": ["DOESNT_FIT", "ARRIVED_DAMAGED", "WRONG_ITEM", "CHANGED_MIND"],
    "returnInstructions": "Please ship items back within 14 days.",
    "autoApprove": false,
    "enableReplacement": true,
    "enableSerialNumbers": false
  }
}`}</pre>
                        </Box>
                      </div>
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>

            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Error Handling */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Error Handling</Text>
              <Text as="p" variant="bodyMd">
                All errors return a consistent JSON structure:
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <Text as="p" variant="bodySm">
                  <span style={{ fontFamily: "var(--p-font-family-mono, monospace)" }}>
                    {'{'}<br />
                    &nbsp;&nbsp;"error": {'{'}<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;"code": "BAD_REQUEST",<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;"message": "Description of what went wrong"<br />
                    &nbsp;&nbsp;{'}'}<br />
                    {'}'}
                  </span>
                </Text>
              </Box>
              <div>
                <Text as="p" variant="bodySm" fontWeight="semibold">HTTP Status Codes:</Text>
                <Box background="bg-surface-secondary" padding="300" borderRadius="200" paddingBlockStart="300">
                  <BlockStack gap="200">
                    <div><strong>400 BAD_REQUEST</strong> — Invalid request or validation error</div>
                    <div><strong>401 UNAUTHORIZED</strong> — Missing or invalid API key</div>
                    <div><strong>403 FORBIDDEN</strong> — Valid key but insufficient scope</div>
                    <div><strong>404 NOT_FOUND</strong> — Resource not found</div>
                    <div><strong>405 METHOD_NOT_ALLOWED</strong> — HTTP method not allowed for this endpoint</div>
                    <div><strong>409 CONFLICT</strong> — Invalid state transition or business logic constraint</div>
                    <div><strong>500 INTERNAL_ERROR</strong> — Server error</div>
                  </BlockStack>
                </Box>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Scopes */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">API Scopes</Text>
              <Text as="p" variant="bodyMd">
                Each API key has specific scopes that control access to endpoints:
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="300">
                  <div>
                    <Badge tone="info">returns:read</Badge>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Read return data (list, detail, timeline, comments, label)
                    </Text>
                  </div>
                  <div>
                    <Badge tone="warning">returns:write</Badge>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Execute actions on returns (approve, reject, refund, etc.) and add comments
                    </Text>
                  </div>
                  <div>
                    <Badge tone="info">settings:read</Badge>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Read shop return settings (read-only, no write API available)
                    </Text>
                  </div>
                  <div>
                    <Badge tone="critical">admin</Badge>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Full access to all endpoints (includes all above scopes)
                    </Text>
                  </div>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Status Values */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Return Status Values</Text>
              <Text as="p" variant="bodyMd">
                Returns can have the following status values:
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="200">
                  <div><strong>SUBMITTED</strong> — Return request submitted by customer</div>
                  <div><strong>PENDING_REVIEW</strong> — Awaiting merchant review</div>
                  <div><strong>APPROVED</strong> — Return approved by merchant</div>
                  <div><strong>REJECTED</strong> — Return rejected by merchant</div>
                  <div><strong>AWAITING_SHIPMENT</strong> — Waiting for customer to ship items</div>
                  <div><strong>IN_TRANSIT</strong> — Items shipped and in transit to warehouse</div>
                  <div><strong>RECEIVED</strong> — Items received at warehouse</div>
                  <div><strong>PARTIALLY_ACCEPTED</strong> — Some items accepted, some rejected after inspection</div>
                  <div><strong>REFUNDED</strong> — Refund processed to customer</div>
                  <div><strong>EXCHANGED</strong> — Exchange/replacement order created</div>
                  <div><strong>CLOSED</strong> — Return completed and closed</div>
                  <div><strong>CANCELLED</strong> — Return cancelled</div>
                </BlockStack>
              </Box>
              <Divider />
              <div>
                <Text as="p" variant="bodySm" fontWeight="semibold">Common State Transitions:</Text>
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="200">
                    <div>SUBMITTED → PENDING_REVIEW (auto or manual)</div>
                    <div>PENDING_REVIEW → APPROVED (approve action)</div>
                    <div>PENDING_REVIEW → REJECTED (reject action)</div>
                    <div>APPROVED → AWAITING_SHIPMENT → IN_TRANSIT → RECEIVED</div>
                    <div>RECEIVED → PARTIALLY_ACCEPTED (partial acceptance)</div>
                    <div>RECEIVED → REFUNDED (process_refund action)</div>
                    <div>RECEIVED → EXCHANGED (process_replacement action)</div>
                    <div>PARTIALLY_ACCEPTED → REFUNDED (partial refund)</div>
                    <div>PARTIALLY_ACCEPTED → EXCHANGED (partial replacement)</div>
                    <div>REJECTED → CLOSED (close rejected return)</div>
                    <div>REFUNDED → CLOSED (auto-close)</div>
                    <div>EXCHANGED → CLOSED (auto-close)</div>
                    <div>Any non-final status → CANCELLED (cancel action)</div>
                  </BlockStack>
                </Box>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
