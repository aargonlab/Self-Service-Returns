import { Resend } from "resend";
import {
  returnConfirmationTemplate,
  returnApprovedTemplate,
  returnRejectedTemplate,
  refundProcessedTemplate,
  refundOtpTemplate,
} from "./emailTemplates.server";
import type { ReturnRequest, ReturnItem } from "@prisma/client";

type ReturnWithItems = ReturnRequest & { items: ReturnItem[] };

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.EMAIL_FROM || "";

// Startup validation
if (!process.env.EMAIL_FROM) {
  console.warn("[Email] WARNING: EMAIL_FROM not set. Emails will not be sent until configured.");
}

const APP_URL = (() => {
  const url = process.env.APP_URL;

  if (!url) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Email] CRITICAL: APP_URL not set in production. Emails with links will fail.");
      return ""; // Empty string — getStatusUrl will generate relative URLs that won't work in emails
    }
    console.warn("[Email] WARNING: APP_URL not set. Using default: http://localhost:3000");
    return "http://localhost:3000";
  }

  // Strip trailing slash for consistent URL construction
  const cleaned = url.replace(/\/+$/, "");

  // Validate URL scheme
  if (!cleaned.startsWith("https://") && !cleaned.startsWith("http://")) {
    console.warn(`[Email] WARNING: APP_URL does not start with http:// or https://. Received: ${url}. Falling back to http://localhost:3000`);
    return "http://localhost:3000";
  }

  // Validate it's a valid URL
  try {
    new URL(cleaned);
  } catch {
    console.warn(`[Email] WARNING: APP_URL is not a valid URL: ${url}. Falling back to http://localhost:3000`);
    return "http://localhost:3000";
  }

  return cleaned;
})();

function getStatusUrl(returnRequest: ReturnRequest): string {
  const encodedEmail = encodeURIComponent(returnRequest.customerEmail);
  const encodedOrderId = encodeURIComponent(returnRequest.shopifyOrderId);
  const encodedShop = encodeURIComponent(returnRequest.shop);

  if (!APP_URL) {
    console.error(`[Email] Cannot generate status URL: APP_URL not configured. Return ID: ${returnRequest.id}`);
    return `https://${returnRequest.shop}/apps/self-service-returns/returns/${returnRequest.id}/status?shop=${encodedShop}&email=${encodedEmail}&orderId=${encodedOrderId}`;
  }
  if (APP_URL.includes("localhost")) {
    console.warn(`[Email] APP_URL contains localhost. Return status link may not work for return ${returnRequest.id}`);
  }
  // Use URL constructor to safely handle base URL with or without path components
  const path = `/returns/${returnRequest.id}/status?shop=${encodedShop}&email=${encodedEmail}&orderId=${encodedOrderId}`;
  return new URL(path, APP_URL).toString();
}

function getEmailData(returnRequest: ReturnWithItems) {
  return {
    customerName: returnRequest.customerName,
    orderName: returnRequest.shopifyOrderName,
    items: returnRequest.items.map((item) => ({
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      quantity: item.quantity,
    })),
    returnId: returnRequest.id,
    statusUrl: getStatusUrl(returnRequest),
  };
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    throw new Error("Resend API key not configured");
  }

  if (!FROM_EMAIL) {
    throw new Error("EMAIL_FROM not configured");
  }

  // Basic format check — definitive validation happens when the email is sent
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    console.error(`[Email] Invalid email address: ${to}`);
    return; // Skip sending to invalid address
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });
}

export async function sendReturnConfirmationEmail(
  returnRequest: ReturnWithItems,
): Promise<void> {
  const data = getEmailData(returnRequest);
  const { subject, html } = returnConfirmationTemplate(data);
  await sendEmail(returnRequest.customerEmail, subject, html);
}

export async function sendReturnApprovedEmail(
  returnRequest: ReturnWithItems,
  instructions?: string,
): Promise<void> {
  const data = getEmailData(returnRequest);
  const { subject, html } = returnApprovedTemplate({
    ...data,
    instructions,
  });
  await sendEmail(returnRequest.customerEmail, subject, html);
}

export async function sendReturnRejectedEmail(
  returnRequest: ReturnWithItems,
  reason?: string,
): Promise<void> {
  const data = getEmailData(returnRequest);
  const { subject, html } = returnRejectedTemplate({
    ...data,
    reason,
  });
  await sendEmail(returnRequest.customerEmail, subject, html);
}

export async function sendRefundProcessedEmail(
  returnRequest: ReturnWithItems,
  amount?: string,
  currency?: string,
): Promise<void> {
  const data = getEmailData(returnRequest);
  const { subject, html } = refundProcessedTemplate({
    ...data,
    amount,
    currency,
  });
  await sendEmail(returnRequest.customerEmail, subject, html);
}

export async function sendRefundOtpEmail(
  email: string,
  code: string,
  shopName: string,
): Promise<void> {
  const { subject, html } = refundOtpTemplate({ code, shopName });
  await sendEmail(email, subject, html);
}
