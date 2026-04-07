function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface ReturnEmailData {
  customerName: string;
  orderName: string;
  items: Array<{
    productTitle: string;
    variantTitle?: string | null;
    quantity: number;
  }>;
  returnId: string;
  statusUrl: string;
}

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Return Update</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: #0ea5e9; padding: 24px 32px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">Return Center</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
                Powered by SSR
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function itemsList(items: ReturnEmailData["items"]): string {
  return items
    .map(
      (item) =>
        `<tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;">
            <span style="font-weight: 500;">${escapeHtml(item.productTitle)}</span>
            ${item.variantTitle ? `<br><span style="color: #6b7280; font-size: 13px;">${escapeHtml(item.variantTitle)}</span>` : ""}
          </td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; text-align: right; color: #6b7280;">
            Qty: ${item.quantity}
          </td>
        </tr>`,
    )
    .join("");
}

function statusButton(url: string, label: string = "View Return Status"): string {
  // Validate URL scheme to prevent javascript: injection
  let safeUrl = url.startsWith("http://") || url.startsWith("https://")
    ? url
    : "#";

  // In production, enforce https:// to prevent insecure links
  if (process.env.NODE_ENV === "production" && safeUrl.startsWith("http://")) {
    console.warn(`[EmailTemplates] WARNING: http:// URL detected in production, upgrading to https://: ${url}`);
    safeUrl = safeUrl.replace(/^http:\/\//, "https://");
  }

  if (safeUrl === "#") {
    console.warn(`[EmailTemplates] Invalid URL provided to statusButton: ${url}. Omitting button to prevent dead link.`);
    // Don't render a button with a dead link
    return "";
  }

  const safeLabel = escapeHtml(label);
  safeUrl = escapeHtml(safeUrl);
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
    <tr>
      <td align="center">
        <a href="${safeUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0ea5e9; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">${safeLabel}</a>
      </td>
    </tr>
  </table>`;
}

export function returnConfirmationTemplate(data: ReturnEmailData): { subject: string; html: string } {
  return {
    subject: `Return Request Received — Order ${escapeHtml(data.orderName)}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; font-size: 18px; color: #111827;">We've received your return request</h2>
      <p style="margin: 0 0 24px; color: #4b5563; font-size: 14px; line-height: 1.5;">
        Hi ${escapeHtml(data.customerName)}, we've received your return request for order <strong>${escapeHtml(data.orderName)}</strong>.
        Our team will review it and get back to you shortly.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
        <tr>
          <td style="padding-bottom: 8px;">
            <strong style="font-size: 14px; color: #374151;">Items being returned:</strong>
          </td>
        </tr>
        ${itemsList(data.items)}
      </table>
      ${statusButton(data.statusUrl)}
    `),
  };
}

export function returnApprovedTemplate(
  data: ReturnEmailData & { instructions?: string },
): { subject: string; html: string } {
  return {
    subject: `Return Approved — Order ${escapeHtml(data.orderName)}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; font-size: 18px; color: #111827;">Your return has been approved</h2>
      <p style="margin: 0 0 24px; color: #4b5563; font-size: 14px; line-height: 1.5;">
        Hi ${escapeHtml(data.customerName)}, great news! Your return request for order <strong>${escapeHtml(data.orderName)}</strong>
        has been approved.
      </p>
      ${
        data.instructions
          ? `<div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 16px; margin-bottom: 16px;">
              <strong style="display: block; margin-bottom: 8px; font-size: 14px; color: #0369a1;">Return Instructions</strong>
              <p style="margin: 0; font-size: 14px; color: #0c4a6e; line-height: 1.5; white-space: pre-line;">${escapeHtml(data.instructions)}</p>
            </div>`
          : ""
      }
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
        <tr>
          <td style="padding-bottom: 8px;">
            <strong style="font-size: 14px; color: #374151;">Items to return:</strong>
          </td>
        </tr>
        ${itemsList(data.items)}
      </table>
      ${statusButton(data.statusUrl)}
    `),
  };
}

export function returnRejectedTemplate(
  data: ReturnEmailData & { reason?: string },
): { subject: string; html: string } {
  return {
    subject: `Return Request Update — Order ${escapeHtml(data.orderName)}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; font-size: 18px; color: #111827;">Return request update</h2>
      <p style="margin: 0 0 16px; color: #4b5563; font-size: 14px; line-height: 1.5;">
        Hi ${escapeHtml(data.customerName)}, we've reviewed your return request for order <strong>${escapeHtml(data.orderName)}</strong>.
        Unfortunately, we're unable to approve this return at this time.
      </p>
      ${
        data.reason
          ? `<div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px; margin-bottom: 16px;">
              <strong style="display: block; margin-bottom: 4px; font-size: 14px; color: #991b1b;">Reason</strong>
              <p style="margin: 0; font-size: 14px; color: #7f1d1d; line-height: 1.5;">${escapeHtml(data.reason)}</p>
            </div>`
          : ""
      }
      <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.5;">
        If you have questions, please contact our support team.
      </p>
      ${statusButton(data.statusUrl)}
    `),
  };
}

export function refundProcessedTemplate(
  data: ReturnEmailData & { amount?: string; currency?: string },
): { subject: string; html: string } {
  return {
    subject: `Refund Processed — Order ${escapeHtml(data.orderName)}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; font-size: 18px; color: #111827;">Your refund has been processed</h2>
      <p style="margin: 0 0 16px; color: #4b5563; font-size: 14px; line-height: 1.5;">
        Hi ${escapeHtml(data.customerName)}, your refund for order <strong>${escapeHtml(data.orderName)}</strong> has been processed.
        ${data.amount ? ` A refund of <strong>${escapeHtml(data.currency || "")} ${escapeHtml(data.amount)}</strong> has been issued.` : ""}
      </p>
      <p style="margin: 0 0 24px; color: #4b5563; font-size: 14px; line-height: 1.5;">
        Please allow 5-10 business days for the refund to appear in your account, depending on your payment method.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
        <tr>
          <td style="padding-bottom: 8px;">
            <strong style="font-size: 14px; color: #374151;">Refunded items:</strong>
          </td>
        </tr>
        ${itemsList(data.items)}
      </table>
      ${statusButton(data.statusUrl)}
    `),
  };
}

interface RefundOtpEmailData {
  code: string;
  shopName: string;
}

export function refundOtpTemplate(data: RefundOtpEmailData): { subject: string; html: string } {
  return {
    subject: `Your refund verification code`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; font-size: 18px; color: #111827;">Refund Verification Code</h2>
      <p style="margin: 0 0 24px; color: #4b5563; font-size: 14px; line-height: 1.5;">
        You requested a verification code to process a refund for <strong>${escapeHtml(data.shopName)}</strong>.
      </p>
      <div style="background-color: #f3f4f6; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">Your verification code is:</p>
        <p style="margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827; font-family: monospace;">
          ${escapeHtml(data.code)}
        </p>
      </div>
      <p style="margin: 0 0 8px; color: #4b5563; font-size: 14px; line-height: 1.5;">
        This code expires in <strong>10 minutes</strong>.
      </p>
      <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">
        If you did not request this code, please ignore this email or contact your store administrator.
      </p>
    `),
  };
}
