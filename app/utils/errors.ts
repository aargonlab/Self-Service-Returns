export class ReturnNotFoundError extends Error {
  constructor(id: string) {
    super(`Return request not found: ${id}`);
    this.name = "ReturnNotFoundError";
  }
}

export class OrderNotEligibleError extends Error {
  public reasons: string[];

  constructor(reasons: string[]) {
    super(`Order not eligible for return: ${reasons.join(", ")}`);
    this.name = "OrderNotEligibleError";
    this.reasons = reasons;
  }
}

export class ShopifyApiError extends Error {
  public statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(`Shopify API error: ${message}`);
    this.name = "ShopifyApiError";
    this.statusCode = statusCode;
  }
}

export class ValidationError extends Error {
  public fieldErrors: Record<string, string[]>;

  constructor(fieldErrors: Record<string, string[]>) {
    super("Validation failed");
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}
