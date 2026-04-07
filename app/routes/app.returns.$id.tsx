import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigation,
  Form,
  useActionData,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  Thumbnail,
  Button,
  TextField,
  Checkbox,
  Banner,
  Modal,
  FormLayout,
  SkeletonPage,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useState, useRef, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { getReturnRequest } from "~/models/returnRequest.server";
import { getShippingLabel } from "~/services/shippingLabel.server";
import { getAvailableTransitions } from "~/services/stateMachine.server";
import { getSettings } from "~/models/returnSettings.server";
import {
  getReplacementInstruction,
} from "~/models/replacement.server";
import {
  approveReturn,
  rejectReturn,
  cancelReturn,
  processRefundAction,
  processReplacementAction,
  transitionStatusAction,
  addCommentAction,
} from "~/services/returnActions.server";
import { requestRefundOtp, verifyRefundOtp, validateSessionToken } from "~/services/refundOtp.server";
import RefundOtpModal from "~/components/admin/RefundOtpModal";
import { ReturnStatusBadge } from "~/components/admin/ReturnStatusBadge";
import {
  STATUS_LABELS,
} from "~/utils/constants";
import prisma from "~/db.server";
import type { ReturnStatus } from "@prisma/client";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const returnRequest = await getReturnRequest(params.id!, session.shop);

  if (!returnRequest || returnRequest.shop !== session.shop) {
    throw new Response("Not found", { status: 404 });
  }

  const availableTransitions = getAvailableTransitions(returnRequest.status);
  const settings = await getSettings(session.shop);
  const replacementInstruction = await getReplacementInstruction(params.id!, session.shop);
  const shippingLabel = await getShippingLabel(params.id!, session.shop);

  // Batch load reason labels to avoid N+1 queries
  const uniqueReasonCodes = [...new Set(returnRequest.items.map(i => i.returnReason).filter(Boolean))];
  // BUG 6 FIX: Wrap reason query in try-catch with fallback
  let reasonRows: Array<{ code: string; label: string }> = [];
  try {
    reasonRows = await prisma.customReason.findMany({
      where: { shop: session.shop, code: { in: uniqueReasonCodes } },
      select: { code: true, label: true },
    });
  } catch (e) {
    console.warn("[ReturnDetail] Failed to load custom reasons:", e);
  }
  const reasonLabels: Record<string, string> = {};
  for (const row of reasonRows) {
    reasonLabels[row.code] = row.label;
  }
  // Fallback for codes not found in DB
  const LEGACY_LABELS: Record<string, string> = {
    DOESNT_FIT: "Item doesn't fit",
    NOT_AS_DESCRIBED: "Item not as described",
    ARRIVED_DAMAGED: "Item arrived damaged",
    WRONG_ITEM: "Wrong item received",
    CHANGED_MIND: "Changed my mind",
    QUALITY_NOT_EXPECTED: "Quality not as expected",
    OTHER: "Other",
  };
  for (const code of uniqueReasonCodes) {
    if (!reasonLabels[code]) {
      reasonLabels[code] = LEGACY_LABELS[code] || code;
    }
  }

  return json({
    returnRequest,
    availableTransitions,
    settings,
    replacementInstruction,
    reasonLabels,
    shippingLabel,
  });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const returnId = params.id!;

  if (!intent) {
    return json({ success: false, message: "Missing action intent." }, { status: 400 });
  }

  // Verify ownership
  const returnRequest = await getReturnRequest(returnId, session.shop);
  if (!returnRequest || returnRequest.shop !== session.shop) {
    return json({ success: false, message: "Return not found." }, { status: 404 });
  }

  // Extract real admin user name from session if available
  let actorName = "Admin";
  if (session.onlineAccessInfo?.associated_user) {
    const user = session.onlineAccessInfo.associated_user;
    actorName = user.first_name ? `${user.first_name}${user.last_name ? ` ${user.last_name}` : ""}`.trim() : user.email || "Admin";
  }
  const actor = { name: actorName, type: "AGENT" as const };

  try {
    let result;

    if (intent === "request-refund-otp") {
      const email = formData.get("email") as string;
      if (!email) {
        return json({ otpError: "Email is required." });
      }
      const result = await requestRefundOtp(session.shop, email);
      if (result.success) {
        return json({ otpSent: true });
      }
      return json({ otpError: result.message });
    }

    if (intent === "verify-refund-otp") {
      const email = formData.get("email") as string;
      const code = formData.get("code") as string;
      if (!email || !code) {
        return json({ otpError: "Email and code are required." });
      }
      const result = await verifyRefundOtp(session.shop, email, code);
      if (result.success) {
        return json({ otpVerified: true, sessionToken: result.sessionToken, expiresAt: result.expiresAt });
      }
      return json({ otpError: result.message });
    }

    if (intent === "approve") {
      result = await approveReturn(admin, returnId, session.shop, actor);
    } else if (intent === "reject") {
      const reason = formData.get("reason") as string;
      result = await rejectReturn(returnId, session.shop, reason, actor);
    } else if (intent === "update-status") {
      const newStatus = formData.get("status") as string;
      if (newStatus === "REFUNDED") {
        const refundSessionToken = formData.get("refundSessionToken") as string;
        if (!refundSessionToken) {
          return json({ success: false, message: "Refund authorization required. Please verify your identity." }, { status: 401 });
        }
        const sessionValid = await validateSessionToken(session.shop, refundSessionToken);
        if (!sessionValid) {
          return json({ success: false, message: "Refund session expired or invalid. Please verify again." }, { status: 401 });
        }
        result = await processRefundAction(admin, returnId, session.shop, actor);
      } else if (newStatus === "EXCHANGED") {
        const replacementNotes = formData.get("replacementNotes") as string;
        result = await processReplacementAction(admin, returnId, session.shop, replacementNotes, actor);
      } else {
        result = await transitionStatusAction(returnId, newStatus, session.shop, actor);
      }
    } else if (intent === "comment") {
      const content = formData.get("content") as string;
      const isInternal = formData.get("isInternal") === "true";
      result = await addCommentAction(returnId, content, isInternal, session.shop, actor);
    } else if (intent === "cancel") {
      result = await cancelReturn(admin, returnId, session.shop, actor);
    } else {
      return json({ success: false, message: "Unknown action." }, { status: 400 });
    }

    return json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error("Return action error:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    return json({ success: false, message: `Action failed: ${message}` }, { status: 400 });
  }
};

export default function ReturnDetail() {
  const navigation = useNavigation();
  const {
    returnRequest,
    availableTransitions,
    replacementInstruction,
    reasonLabels,
    shippingLabel,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const isSubmitting = navigation.state === "submitting";

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [commentText, setCommentText] = useState("");
  const [isInternalComment, setIsInternalComment] = useState(false);
  const [replacementModalOpen, setReplacementModalOpen] = useState(false);
  const [replacementNotes, setReplacementNotes] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [refundOtpModalOpen, setRefundOtpModalOpen] = useState(false);
  const [refundSessionToken, setRefundSessionToken] = useState<string | null>(null);

  // Bug #279 Fix: Close modals after successful form submission
  const prevNavigationState = useRef(navigation.state);
  useEffect(() => {
    if (prevNavigationState.current === "submitting" && navigation.state === "idle") {
      // Close modals when actionData changes (form completed)
      if (actionData && (actionData as any).success) {
        setRejectModalOpen(false);
        setReplacementModalOpen(false);
        setRejectReason("");
        setReplacementNotes("");
        setCommentText("");
      }
    }
    prevNavigationState.current = navigation.state;
  }, [navigation.state, actionData]);

  // Reset banner dismissal when new actionData arrives
  useEffect(() => {
    if (actionData) {
      setBannerDismissed(false);
    }
  }, [actionData]);

  // Show toast for success actions
  useEffect(() => {
    if (actionData && 'success' in actionData && actionData.success && 'message' in actionData && actionData.message) {
      shopify.toast.show(actionData.message);
    }
  }, [actionData]);

  // Bug #272 Fix: Helper for safe address field access
  const getAddressField = (obj: any, field: string): string => {
    try {
      const value = obj?.[field];
      return value ? String(value) : "";
    } catch {
      return "";
    }
  };

  if (navigation.state === "loading") {
    return (
      <SkeletonPage primaryAction backAction title="">
        <Layout>
          <Layout.Section>
            <Card>
              <SkeletonBodyText lines={4} />
            </Card>
            <Card>
              <SkeletonBodyText lines={6} />
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <SkeletonBodyText lines={5} />
            </Card>
            <Card>
              <SkeletonBodyText lines={4} />
            </Card>
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  const status = returnRequest.status as ReturnStatus;
  const canApprove = availableTransitions.includes("APPROVED");
  const canReject = availableTransitions.includes("REJECTED");
  const canCancel = availableTransitions.includes("CANCELLED");

  return (
    <Page
      backAction={{ content: "Returns", url: "/app/returns" }}
      title={`Return for ${returnRequest.shopifyOrderName}`}
      subtitle={`${returnRequest.customerName} · ${returnRequest.customerEmail}`}
      titleMetadata={<ReturnStatusBadge status={status} />}
    >
      {actionData && !bannerDismissed && !(actionData as any).success && (
        <div style={{ marginBottom: "16px" }}>
          <Banner
            tone="critical"
            onDismiss={() => setBannerDismissed(true)}
          >
            <p>{(actionData as any).message}</p>
          </Banner>
        </div>
      )}

      {returnRequest.windowOverride && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone="info">
            <p>
              <strong>Return window override.</strong> This return was created outside the standard return window with admin authorization.
            </p>
          </Banner>
        </div>
      )}

      {returnRequest.requireManualApproval && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone="warning">
            <p>
              <strong>Manual review required.</strong> A return policy rule has flagged this return for manual approval. Please review the items and approve or reject accordingly.
            </p>
          </Banner>
        </div>
      )}

      {returnRequest.requiresShoppingEligibility && !returnRequest.disclaimerAcceptedAt && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone="critical">
            <p>
              <strong>Shipping eligibility disclaimer pending.</strong> The customer must accept the shipping eligibility disclaimer before this return can be approved.
            </p>
          </Banner>
        </div>
      )}

      {returnRequest.requiresShoppingEligibility && returnRequest.disclaimerAcceptedAt && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone="success">
            <p>
              Shipping eligibility disclaimer accepted by the customer on{" "}
              {new Date(returnRequest.disclaimerAcceptedAt).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
              })}.
            </p>
          </Banner>
        </div>
      )}

      <Layout>
        {/* Main content */}
        <Layout.Section>
          {/* Order Info */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Order Information</Text>
              <InlineStack gap="400">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">Order</Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {returnRequest.shopifyOrderName}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">Customer</Text>
                  <Text as="span" variant="bodyMd">{returnRequest.customerName}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">Email</Text>
                  <Text as="span" variant="bodyMd">{returnRequest.customerEmail}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued">Submitted</Text>
                  <Text as="span" variant="bodyMd">
                    {new Date(returnRequest.createdAt).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Items */}
          <div style={{ marginTop: "16px" }}>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Return Items ({returnRequest.items.length})
                </Text>
                {returnRequest.items.map((item, idx) => (
                  <div key={item.id}>
                    {idx > 0 && <Divider />}
                    <Box paddingBlockStart={idx > 0 ? "300" : "0"}>
                      <InlineStack gap="400" blockAlign="start">
                        {item.imageUrl ? (
                          <Thumbnail
                            source={item.imageUrl}
                            alt={item.productTitle}
                            size="medium"
                          />
                        ) : (
                          <div style={{ width: 40, height: 40, background: "#f1f1f1", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#999" }}>
                            {item.productTitle.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {item.productTitle}
                          </Text>
                          {item.variantTitle && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              {item.variantTitle}
                            </Text>
                          )}
                          <InlineStack gap="200">
                            <Text as="span" variant="bodySm">Qty: {item.quantity}</Text>
                            {item.sku && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                SKU: {item.sku}
                              </Text>
                            )}
                            {item.price && (
                              <Text as="span" variant="bodySm">
                                {item.price}
                              </Text>
                            )}
                          </InlineStack>
                          <InlineStack gap="200">
                            <Badge>
                              {reasonLabels[item.returnReason] || item.returnReason}
                            </Badge>
                            {item.compositeCode && (
                              <Badge tone="attention">
                                {item.compositeCode}
                              </Badge>
                            )}
                          </InlineStack>
                          {item.customerNote && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              Note: "{item.customerNote}"
                            </Text>
                          )}
                        </BlockStack>
                      </InlineStack>
                    </Box>
                  </div>
                ))}
              </BlockStack>
            </Card>
          </div>

          {/* Label Generation Prompt */}
          {!shippingLabel && (status === "AWAITING_SHIPMENT" || status === "APPROVED") && (
            <div style={{ marginTop: "16px" }}>
              <Banner tone="info">
                <p>No shipping label has been generated yet. The label is auto-generated when the return is approved if the order has a shipping address.</p>
              </Banner>
            </div>
          )}

          {/* Shipping Label */}
          {shippingLabel && (
            <div style={{ marginTop: "16px" }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">Return Shipping Label</Text>
                      <InlineStack gap="200">
                        <Badge tone="info">{shippingLabel.carrier}</Badge>
                        <Badge tone={shippingLabel.status === "CREATED" ? "attention" : shippingLabel.status === "IN_TRANSIT" ? "warning" : "success"}>
                          {shippingLabel.status === "CREATED" ? "Ready" : shippingLabel.status === "IN_TRANSIT" ? "In Transit" : "Delivered"}
                        </Badge>
                      </InlineStack>
                    </BlockStack>
                    <Button
                      url={shippingLabel.labelUrl}
                      target="_blank"
                      variant="primary"
                    >
                      Print Label
                    </Button>
                  </InlineStack>

                  <Divider />

                  {/* Tracking Info */}
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">Tracking Number</Text>
                        <InlineStack gap="200">
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            {shippingLabel.trackingNumber}
                          </Text>
                          {shippingLabel.trackingUrl && (
                            <Button url={shippingLabel.trackingUrl} target="_blank" variant="plain" size="slim">
                              Track
                            </Button>
                          )}
                        </InlineStack>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">Carrier</Text>
                        <Text as="span" variant="bodyMd">{shippingLabel.carrier}</Text>
                      </InlineStack>
                      {shippingLabel.estimatedDelivery && (
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm" tone="subdued">Est. Delivery</Text>
                          <Text as="span" variant="bodyMd">{shippingLabel.estimatedDelivery}</Text>
                        </InlineStack>
                      )}
                      {shippingLabel.weight && (
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm" tone="subdued">Weight</Text>
                          <Text as="span" variant="bodyMd">{shippingLabel.weight}</Text>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Box>

                  {/* Address Summary */}
                  <InlineStack gap="400" align="space-between" wrap>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued" fontWeight="bold">Ship From (Customer)</Text>
                      <Text as="p" variant="bodySm">
                        {getAddressField(shippingLabel.customerAddress, 'name') || "N/A"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {getAddressField(shippingLabel.customerAddress, 'address1') || "N/A"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {getAddressField(shippingLabel.customerAddress, 'zip') || "N/A"} {getAddressField(shippingLabel.customerAddress, 'city') || "N/A"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {getAddressField(shippingLabel.customerAddress, 'country') || "N/A"}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" tone="subdued" fontWeight="bold">Ship To (Warehouse)</Text>
                      <Text as="p" variant="bodySm">
                        {getAddressField(shippingLabel.warehouseAddress, 'name') || "N/A"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {getAddressField(shippingLabel.warehouseAddress, 'address1') || "N/A"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {getAddressField(shippingLabel.warehouseAddress, 'zip') || "N/A"} {getAddressField(shippingLabel.warehouseAddress, 'city') || "N/A"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {getAddressField(shippingLabel.warehouseAddress, 'country') || "N/A"}
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  {/* Label Preview */}
                  <Divider />
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">Label Preview</Text>
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <div style={{ textAlign: "center" }}>
                        {!brokenImages.has(shippingLabel.labelUrl) ? (
                          <img
                            src={shippingLabel.labelUrl}
                            alt="Return shipping label"
                            onError={() => setBrokenImages(prev => new Set(prev).add(shippingLabel.labelUrl))}
                            style={{
                              maxWidth: "100%",
                              width: "400px",
                              border: "1px solid #ddd",
                              borderRadius: "4px",
                            }}
                          />
                        ) : (
                          <div style={{ padding: "40px", color: "#999" }}>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Label preview unavailable
                            </Text>
                          </div>
                        )}
                      </div>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Created on {new Date(shippingLabel.createdAt).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </div>
          )}

          {/* Comments */}
          <div style={{ marginTop: "16px" }}>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Comments</Text>
                {returnRequest.comments.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No comments yet.
                  </Text>
                ) : (
                  returnRequest.comments.map((comment) => (
                    <Box
                      key={comment.id}
                      background={comment.isInternal ? "bg-surface-warning" : "bg-surface-secondary"}
                      padding="300"
                      borderRadius="200"
                    >
                      <BlockStack gap="100">
                        <InlineStack align="space-between">
                          <InlineStack gap="200">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {comment.authorType === "CUSTOMER" ? "Customer" : comment.author}
                            </Text>
                            {comment.isInternal && (
                              <Badge tone="warning">Internal</Badge>
                            )}
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {new Date(comment.createdAt).toLocaleDateString("en-US", {
                              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                            })}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodyMd">{comment.content}</Text>
                      </BlockStack>
                    </Box>
                  ))
                )}

                <Divider />
                <Form method="post">
                  <input type="hidden" name="intent" value="comment" />
                  <input type="hidden" name="isInternal" value={String(isInternalComment)} />
                  <FormLayout>
                    <TextField
                      label="Add a comment"
                      value={commentText}
                      onChange={setCommentText}
                      multiline={3}
                      autoComplete="off"
                      name="content"
                    />
                    <InlineStack gap="300" blockAlign="center">
                      <Checkbox
                        label="Internal note (not visible to customer)"
                        checked={isInternalComment}
                        onChange={setIsInternalComment}
                      />
                      <Button submit disabled={!commentText.trim() || isSubmitting}>
                        Add Comment
                      </Button>
                    </InlineStack>
                  </FormLayout>
                </Form>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Sidebar */}
        <Layout.Section variant="oneThird">
          {/* Actions */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Actions</Text>

              {canApprove && (
                <>
                  {returnRequest.requiresShoppingEligibility && !returnRequest.disclaimerAcceptedAt && (
                    <Banner tone="warning">
                      <p>
                        <strong>Approval blocked.</strong> The customer has not yet accepted the shipping eligibility disclaimer. Approval will be available once the customer accepts.
                      </p>
                    </Banner>
                  )}
                  <Form method="post">
                    <input type="hidden" name="intent" value="approve" />
                    <Button
                      submit
                      variant="primary"
                      fullWidth
                      disabled={isSubmitting || (returnRequest.requiresShoppingEligibility && !returnRequest.disclaimerAcceptedAt)}
                    >
                      Approve Return
                    </Button>
                  </Form>
                </>
              )}

              {canReject && (
                <Button
                  variant="primary"
                  tone="critical"
                  fullWidth
                  onClick={() => setRejectModalOpen(true)}
                >
                  Reject Return
                </Button>
              )}

              {/* Other status transitions — hide the action that doesn't match the resolution type */}
              {availableTransitions
                .filter((t) => !["APPROVED", "REJECTED", "CANCELLED"].includes(t))
                .filter((t) => {
                  if (returnRequest.resolutionType === "REFUND" && t === "EXCHANGED") return false;
                  if (returnRequest.resolutionType === "EXCHANGE" && t === "REFUNDED") return false;
                  return true;
                })
                .map((targetStatus) => {
                  // Custom button labels for certain statuses
                  let buttonLabel = `Mark as ${STATUS_LABELS[targetStatus as ReturnStatus]}`;
                  if (targetStatus === "EXCHANGED") {
                    buttonLabel = "Process Replacement";
                  } else if (targetStatus === "REFUNDED") {
                    buttonLabel = "Process Refund";
                  }

                  // Special handling for EXCHANGED - show modal
                  if (targetStatus === "EXCHANGED") {
                    return (
                      <Button
                        key={targetStatus}
                        fullWidth
                        onClick={() => setReplacementModalOpen(true)}
                        disabled={isSubmitting}
                      >
                        {buttonLabel}
                      </Button>
                    );
                  }

                  // Special handling for REFUNDED - OTP gate
                  if (targetStatus === "REFUNDED") {
                    // If we have a valid session, show direct refund form
                    if (refundSessionToken) {
                      return (
                        <Form method="post" key={targetStatus}>
                          <input type="hidden" name="intent" value="update-status" />
                          <input type="hidden" name="status" value="REFUNDED" />
                          <input type="hidden" name="refundSessionToken" value={refundSessionToken} />
                          <Button submit fullWidth disabled={isSubmitting}>
                            Process Refund
                          </Button>
                        </Form>
                      );
                    }
                    // No valid session — show OTP modal trigger
                    return (
                      <Button
                        key={targetStatus}
                        fullWidth
                        onClick={() => setRefundOtpModalOpen(true)}
                        disabled={isSubmitting}
                      >
                        Process Refund
                      </Button>
                    );
                  }

                  return (
                    <Form method="post" key={targetStatus}>
                      <input type="hidden" name="intent" value="update-status" />
                      <input type="hidden" name="status" value={targetStatus} />
                      <Button submit fullWidth disabled={isSubmitting}>
                        {buttonLabel}
                      </Button>
                    </Form>
                  );
                })}

              {canCancel && (
                <>
                  <Divider />
                  <Form method="post">
                    <input type="hidden" name="intent" value="cancel" />
                    <Button submit tone="critical" fullWidth disabled={isSubmitting}>
                      Cancel Return
                    </Button>
                  </Form>
                </>
              )}

              {availableTransitions.length === 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  No actions available for this status.
                </Text>
              )}
            </BlockStack>
          </Card>

          {/* Timeline */}
          <div style={{ marginTop: "16px" }}>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Timeline</Text>
                {returnRequest.timeline.map((event) => (
                  <Box key={event.id} paddingBlockEnd="200">
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm">{event.event}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {event.actor} &middot;{" "}
                        {new Date(event.createdAt).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
                {returnRequest.timeline.length === 0 && (
                  <Text as="p" variant="bodySm" tone="subdued">No events yet.</Text>
                )}
              </BlockStack>
            </Card>
          </div>

          {/* Details */}
          <div style={{ marginTop: "16px" }}>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Details</Text>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">Created</Text>
                  <Text as="span" variant="bodySm">
                    {new Date(returnRequest.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">Updated</Text>
                  <Text as="span" variant="bodySm">
                    {new Date(returnRequest.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </InlineStack>
                {returnRequest.marketId && (
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Market</Text>
                    <Text as="span" variant="bodySm">{returnRequest.marketId}</Text>
                  </InlineStack>
                )}
                {returnRequest.closedAt && (
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Closed</Text>
                    <Text as="span" variant="bodySm">
                      {new Date(returnRequest.closedAt).toLocaleString()}
                    </Text>
                  </InlineStack>
                )}
                {returnRequest.requiresShoppingEligibility && (
                  <>
                    <Divider />
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">Shipping Eligibility</Text>
                      <Badge tone="warning">Required</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">Disclaimer</Text>
                      {returnRequest.disclaimerAcceptedAt ? (
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          Accepted {new Date(returnRequest.disclaimerAcceptedAt).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
                          })}
                        </Text>
                      ) : (
                        <Badge tone="critical">Pending</Badge>
                      )}
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>
          </div>

          {/* Resolution */}
          {(returnRequest.resolutionType || replacementInstruction) && (
            <div style={{ marginTop: "16px" }}>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Resolution</Text>
                  {returnRequest.resolutionType && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">Type</Text>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {returnRequest.resolutionType === "REFUND" && "Refund"}
                        {returnRequest.resolutionType === "EXCHANGE" && "Replacement"}
                      </Text>
                    </InlineStack>
                  )}
                  {replacementInstruction && (
                    <>
                      <Divider />
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">Status</Text>
                        <Badge tone={replacementInstruction.status === "CREATED" ? "success" : "info"}>
                          {replacementInstruction.status}
                        </Badge>
                      </InlineStack>
                      {replacementInstruction.notes && (
                        <Box>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Notes: {replacementInstruction.notes}
                          </Text>
                        </Box>
                      )}
                    </>
                  )}
                </BlockStack>
              </Card>
            </div>
          )}
        </Layout.Section>
      </Layout>

      {/* Reject Modal */}
      <Modal
        open={rejectModalOpen}
        onClose={() => setRejectModalOpen(false)}
        title="Reject Return"
        primaryAction={{
          content: "Reject",
          destructive: true,
          disabled: !rejectReason.trim() || isSubmitting,
          loading: isSubmitting,
          onAction: () => {
            if (isSubmitting) return;
            // BUG 7 FIX: Ensure optional chaining on requestSubmit
            (document.getElementById("reject-form") as HTMLFormElement)?.requestSubmit();
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setRejectModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Form method="post" id="reject-form">
            <input type="hidden" name="intent" value="reject" />
            <TextField
              label="Reason for rejection"
              value={rejectReason}
              onChange={setRejectReason}
              multiline={3}
              autoComplete="off"
              name="reason"
              placeholder="e.g., Items are past the return window"
              helpText="This reason will be visible to the customer."
            />
          </Form>
        </Modal.Section>
      </Modal>

      {/* Replacement Modal */}
      <Modal
        open={replacementModalOpen}
        onClose={() => setReplacementModalOpen(false)}
        title="Process Replacement"
        primaryAction={{
          content: "Process Replacement",
          disabled: isSubmitting,
          loading: isSubmitting,
          onAction: () => {
            if (isSubmitting) return;
            const form = document.getElementById("replacement-form") as HTMLFormElement;
            form?.requestSubmit();
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setReplacementModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Form method="post" id="replacement-form">
            <input type="hidden" name="intent" value="update-status" />
            <input type="hidden" name="status" value="EXCHANGED" />
            <TextField
              label="Replacement notes (optional)"
              value={replacementNotes}
              onChange={setReplacementNotes}
              multiline={3}
              autoComplete="off"
              name="replacementNotes"
              helpText="Add any notes about the replacement items or instructions."
            />
          </Form>
        </Modal.Section>
      </Modal>

      {/* Refund OTP Modal */}
      <RefundOtpModal
        open={refundOtpModalOpen}
        onClose={() => setRefundOtpModalOpen(false)}
        onVerified={(token) => {
          setRefundSessionToken(token);
          setRefundOtpModalOpen(false);
        }}
      />
    </Page>
  );
}
