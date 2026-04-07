/**
 * ProcessWeaver Shipping API Client
 *
 * HTTP client for ProcessWeaver Ship API (v3.1) and Track API (v3.0)
 * Used to generate real carrier shipping labels and track packages
 */

import { validateExternalUrl } from "~/utils/validators";

// ============================================================================
// TypeScript Interfaces
// ============================================================================

export interface LabelAddress {
  name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  zip: string;
  country: string;
  countryCode?: string;
  phone?: string;
}

export interface CarrierAccount {
  accountNumber: string;
  carrier: string;
  serviceType: string;
  password: string;
  userId: string;
  meterNumber: string;
  shipDateFormat?: string; // e.g., "yyyy-MM-dd"
}

export interface ProcessWeaverShipRequest {
  APIKey: string;
  ENV: "TEST" | "PROD";
  LabelFormat: "PNG" | "PDF" | "ZPL";
  CarrierDetails: {
    AccountNumber: string;
    Carrier: string;
    ServiceType: string;
    Password: string;
    UserID: string;
    MeterNumber: string;
    ShipDate: string;
    CustomerTransactionId: string;
  };
  ShipFrom: {
    City: string;
    CompanyName: string;
    Contact: string;
    CountryCode: string;
    PostalCode: string;
    StateOrProvinceCode: string;
    StreetLine1: string;
    StreetLine2?: string;
    Phone: string;
  };
  ShipTo: {
    City: string;
    CompanyName: string;
    Contact: string;
    CountryCode: string;
    PostalCode: string;
    StateOrProvinceCode: string;
    StreetLine1: string;
    StreetLine2?: string;
    Phone: string;
  };
  Paymentinformation: {
    PayerAccountNumber: string;
    PaymentType: "SENDER" | "RECIPIENT" | "THIRD_PARTY";
  };
  PackageCount: string;
  TotalWeight: string;
  Packagedetails: Array<{
    WeightValue: string;
    WeightUnits: "KGS" | "LBS";
    Length: string;
    Width: string;
    Height: string;
    DimensionUnit: "CM" | "IN";
  }>;
  SpecialServices: {
    ReturnShipmentDetail: {
      ReturnShipment: boolean;
      ReturnType: "PRINT_RETURN_LABEL" | "ELECTRONIC_RETURN_LABEL";
    };
  };
}

export interface ProcessWeaverShipResponse {
  SIN?: string;
  Package?: Array<{
    TrackingNumber: string;
    Freight: string;
    DiscountFreight: string;
    ImageUrl: string;
    ImageData: string;
  }>;
  customerTransactionId?: string;
  Carrier?: string;
  Errors?: {
    ErrorCode: string;
    ErrorMessage: string;
  };
}

export interface ProcessWeaverTrackRequest {
  APIKey: string;
  CustomerTransactionId: string;
  CarrierDetails: {
    Carrier: string;
    UserID: string;
    Password: string;
    AccountNumber: string;
    ServiceType: string;
    MeterNumber: string;
  };
  Packages: {
    TrackingNumbers: Array<{ TrackingNumber: string }>;
  };
  IsPODRequired: boolean;
}

export interface ProcessWeaverTrackResponse {
  Carrier?: string;
  CustomerTransactionId?: string;
  TrackingNumbers?: Array<{
    TrackingNumber: string;
    Carrier: string;
    TrackingUrl: string;
    Events: Array<{
      DateTime: string;
      Delivery_Date?: string;
      Location?: string;
      Status: string;
    }>;
    POD_SignedBy?: string;
    POD_Document?: string;
  }>;
  Errors?: {
    ErrorCode: string;
    ErrorMessage: string;
  };
}

export interface ProcessWeaverError {
  errorCode: string;
  errorMessage: string;
}

export interface ShipLabelResult {
  sin: string;
  trackingNumber: string;
  trackingUrl: string;
  carrier: string;
  freight: string;
  labelImageBase64: string;
  labelImageUrl: string;
}

export interface TrackResult {
  trackingNumber: string;
  carrier: string;
  trackingUrl: string;
  events: Array<{
    dateTime: string;
    status: string;
    location?: string;
    deliveryDate?: string;
  }>;
  podSignedBy?: string;
  podDocument?: string;
}

// ============================================================================
// Custom Error Class
// ============================================================================

export class ProcessWeaverApiError extends Error {
  public readonly errorCode: string;
  public readonly errorMessage: string;

  constructor(errorCode: string, errorMessage: string) {
    super(`ProcessWeaver API Error [${errorCode}]: ${errorMessage}`);
    this.name = "ProcessWeaverApiError";
    this.errorCode = errorCode;
    this.errorMessage = errorMessage;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a date according to the specified format string
 * Supports: yyyy-MM-dd (default), MM-dd-yyyy, dd-MM-yyyy
 */
export function formatShipDate(date: Date, format: string = "yyyy-MM-dd"): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  switch (format) {
    case "MM-dd-yyyy":
      return `${month}-${day}-${year}`;
    case "dd-MM-yyyy":
      return `${day}-${month}-${year}`;
    case "yyyy-MM-dd":
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * Sanitize request/response objects before logging to prevent credential exposure
 * Removes sensitive carrier credentials from logs
 */
function sanitizeForLogging(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = { ...obj };
  const sensitiveKeys = ['Password', 'password', 'APIKey', 'apiKey', 'Key', 'MeterNumber', 'UserCredential', 'UserID'];
  for (const key of sensitiveKeys) {
    if (key in sanitized) sanitized[key] = '***REDACTED***';
  }
  // Recursively sanitize nested objects
  if (sanitized.CarrierDetails && typeof sanitized.CarrierDetails === 'object') {
    sanitized.CarrierDetails = sanitizeForLogging(sanitized.CarrierDetails);
  }
  return sanitized;
}

/**
 * Create an AbortController with timeout
 */
function createTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

// ============================================================================
// Build Ship Request
// ============================================================================

export interface BuildShipRequestParams {
  apiKey: string;
  environment: "TEST" | "PROD";
  labelFormat: "PNG" | "PDF" | "ZPL";
  carrierAccount: CarrierAccount;
  shipFrom: LabelAddress;
  shipTo: LabelAddress;
  returnRequestId: string;
  weight?: string;
  dimensions?: {
    length: string;
    width: string;
    height: string;
    unit: "CM" | "IN";
  };
}

/**
 * Build the Ship API request JSON
 * Pure function that assembles the request payload
 *
 * Important: shipFrom = customer (sender), shipTo = warehouse (receiver) for return labels
 */
export function buildShipRequest(params: BuildShipRequestParams): ProcessWeaverShipRequest {
  const {
    apiKey,
    environment,
    labelFormat,
    carrierAccount,
    shipFrom,
    shipTo,
    returnRequestId,
    weight = "1.00",
    dimensions,
  } = params;

  const shipDate = formatShipDate(new Date(), carrierAccount.shipDateFormat || "yyyy-MM-dd");

  const defaultDimensions = {
    length: "30",
    width: "20",
    height: "10",
    unit: "CM" as const,
  };

  const dims = dimensions || defaultDimensions;

  return {
    APIKey: apiKey,
    ENV: environment,
    LabelFormat: labelFormat,
    CarrierDetails: {
      AccountNumber: carrierAccount.accountNumber,
      Carrier: carrierAccount.carrier,
      ServiceType: carrierAccount.serviceType,
      Password: carrierAccount.password,
      UserID: carrierAccount.userId,
      MeterNumber: carrierAccount.meterNumber,
      ShipDate: shipDate,
      CustomerTransactionId: returnRequestId,
    },
    ShipFrom: {
      City: shipFrom.city,
      CompanyName: shipFrom.company || "",
      Contact: shipFrom.name,
      CountryCode: shipFrom.countryCode || (shipFrom.country?.length >= 2 ? shipFrom.country.substring(0, 2).toUpperCase() : ""),
      PostalCode: shipFrom.zip,
      StateOrProvinceCode: shipFrom.province || "",
      StreetLine1: shipFrom.address1,
      ...(shipFrom.address2 && { StreetLine2: shipFrom.address2 }),
      Phone: shipFrom.phone || "",
    },
    ShipTo: {
      City: shipTo.city,
      CompanyName: shipTo.company || "",
      Contact: shipTo.name,
      CountryCode: shipTo.countryCode || (shipTo.country?.length >= 2 ? shipTo.country.substring(0, 2).toUpperCase() : ""),
      PostalCode: shipTo.zip,
      StateOrProvinceCode: shipTo.province || "",
      StreetLine1: shipTo.address1,
      ...(shipTo.address2 && { StreetLine2: shipTo.address2 }),
      Phone: shipTo.phone || "",
    },
    Paymentinformation: {
      PayerAccountNumber: carrierAccount.accountNumber,
      PaymentType: "SENDER",
    },
    PackageCount: "1",
    TotalWeight: weight,
    Packagedetails: [
      {
        WeightValue: weight,
        WeightUnits: "KGS",
        Length: dims.length,
        Width: dims.width,
        Height: dims.height,
        DimensionUnit: dims.unit,
      },
    ],
    SpecialServices: {
      ReturnShipmentDetail: {
        ReturnShipment: true,
        ReturnType: "PRINT_RETURN_LABEL",
      },
    },
  };
}

// ============================================================================
// Generate Label
// ============================================================================

export interface GenerateLabelParams {
  shipEndpoint: string;
  apiKey: string;
  environment: "TEST" | "PROD";
  labelFormat: "PNG" | "PDF" | "ZPL";
  carrierAccount: CarrierAccount;
  shipFrom: LabelAddress;
  shipTo: LabelAddress;
  returnRequestId: string;
  weight?: string;
  dimensions?: {
    length: string;
    width: string;
    height: string;
    unit: "CM" | "IN";
  };
}

/**
 * Generate a shipping label via ProcessWeaver Ship API
 * Makes a POST request and returns the label result
 *
 * @throws ProcessWeaverApiError if the API returns an error
 * @throws Error for network or timeout issues
 */
export async function generateLabel(params: GenerateLabelParams): Promise<ShipLabelResult> {
  const requestBody = buildShipRequest(params);

  console.log(`[ProcessWeaver] Generating label for return request ${params.returnRequestId}`);
  console.log(`[ProcessWeaver] Environment: ${params.environment}`);
  console.log(`[ProcessWeaver] Carrier: ${params.carrierAccount.carrier}, Service: ${params.carrierAccount.serviceType}`);

  let lastError: Error | null = null;
  const maxRetries = 1; // 1 retry = 2 total attempts

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[ProcessWeaver] Retrying request (attempt ${attempt + 1}/${maxRetries + 1}) after 2s delay...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    try {
      // SSRF protection: validate endpoint URL
      validateExternalUrl(params.shipEndpoint, "ProcessWeaver ship endpoint");

      const response = await fetch(params.shipEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: createTimeoutSignal(30000), // 30 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as ProcessWeaverShipResponse;

    console.log(`[ProcessWeaver] Received response for ${params.returnRequestId}`);

    // Check for API errors
    if (data.Errors) {
      console.error(`[ProcessWeaver] API Error: [${data.Errors.ErrorCode}] ${data.Errors.ErrorMessage}`);
      console.error(`[ProcessWeaver] Request details (sanitized):`, sanitizeForLogging(requestBody));
      throw new ProcessWeaverApiError(data.Errors.ErrorCode, data.Errors.ErrorMessage);
    }

    // Validate response structure
    if (!data.Package || data.Package.length === 0) {
      console.error(`[ProcessWeaver] Invalid response structure. Request (sanitized):`, sanitizeForLogging(requestBody));
      throw new Error("Invalid response: missing Package data");
    }

    const packageData = data.Package[0];

    const result: ShipLabelResult = {
      sin: data.SIN || "",
      trackingNumber: packageData.TrackingNumber,
      trackingUrl: packageData.ImageUrl,
      carrier: data.Carrier || params.carrierAccount.carrier,
      freight: packageData.Freight,
      labelImageBase64: packageData.ImageData,
      labelImageUrl: packageData.ImageUrl,
    };

      console.log(`[ProcessWeaver] Label generated successfully. Tracking: ${result.trackingNumber}`);

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error occurred");

      // Don't retry on API errors (bad request, invalid carrier, etc.)
      if (error instanceof ProcessWeaverApiError) {
        // Error already logged with sanitized details above
        throw error;
      }

      // Only retry on network errors or timeouts
      const isNetworkError = error instanceof Error && (
        error.name === "AbortError" ||
        error.message.includes("fetch failed") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("ETIMEDOUT")
      );

      if (!isNetworkError || attempt === maxRetries) {
        // Last attempt or non-retryable error - throw
        break;
      }

      console.warn(`[ProcessWeaver] Retryable error on attempt ${attempt + 1}: ${lastError.message}`);
    }
  }

  // All retries exhausted
  if (lastError) {
    if (lastError.name === "AbortError") {
      console.error(`[ProcessWeaver] Request timeout for ${params.returnRequestId} after ${maxRetries + 1} attempts`);
      throw new Error("ProcessWeaver API request timed out after multiple attempts");
    }
    console.error(`[ProcessWeaver] Request failed for ${params.returnRequestId} after ${maxRetries + 1} attempts:`, lastError.message);
    throw new Error(`Failed to generate label: ${lastError.message}`);
  }

  throw new Error("Unknown error occurred while generating label");
}

// ============================================================================
// Build Track Request
// ============================================================================

export interface BuildTrackRequestParams {
  apiKey: string;
  carrierAccount: CarrierAccount;
  trackingNumbers: string[];
  returnRequestId: string;
  isPODRequired?: boolean;
}

/**
 * Build the Track API request JSON
 * Pure function that assembles the request payload
 */
export function buildTrackRequest(params: BuildTrackRequestParams): ProcessWeaverTrackRequest {
  const { apiKey, carrierAccount, trackingNumbers, returnRequestId, isPODRequired = false } = params;

  return {
    APIKey: apiKey,
    CustomerTransactionId: returnRequestId,
    CarrierDetails: {
      Carrier: carrierAccount.carrier,
      UserID: carrierAccount.userId,
      Password: carrierAccount.password,
      AccountNumber: carrierAccount.accountNumber,
      ServiceType: carrierAccount.serviceType,
      MeterNumber: carrierAccount.meterNumber,
    },
    Packages: {
      TrackingNumbers: trackingNumbers.map((trackingNumber) => ({ TrackingNumber: trackingNumber })),
    },
    IsPODRequired: isPODRequired,
  };
}

// ============================================================================
// Track Package
// ============================================================================

export interface TrackPackageParams {
  trackEndpoint: string;
  apiKey: string;
  carrierAccount: CarrierAccount;
  trackingNumber: string;
  returnRequestId: string;
  isPODRequired?: boolean;
}

/**
 * Track a package via ProcessWeaver Track API
 * Makes a POST request and returns the tracking result
 *
 * @throws ProcessWeaverApiError if the API returns an error
 * @throws Error for network or timeout issues
 */
export async function trackPackage(params: TrackPackageParams): Promise<TrackResult> {
  const requestBody = buildTrackRequest({
    apiKey: params.apiKey,
    carrierAccount: params.carrierAccount,
    trackingNumbers: [params.trackingNumber],
    returnRequestId: params.returnRequestId,
    isPODRequired: params.isPODRequired,
  });

  console.log(`[ProcessWeaver] Tracking package ${params.trackingNumber} for return request ${params.returnRequestId}`);

  try {
    // SSRF protection: validate endpoint URL
    validateExternalUrl(params.trackEndpoint, "ProcessWeaver track endpoint");

    const response = await fetch(params.trackEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: createTimeoutSignal(30000), // 30 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as ProcessWeaverTrackResponse;

    console.log(`[ProcessWeaver] Received tracking response for ${params.trackingNumber}`);

    // Check for API errors
    if (data.Errors) {
      console.error(`[ProcessWeaver] API Error: [${data.Errors.ErrorCode}] ${data.Errors.ErrorMessage}`);
      console.error(`[ProcessWeaver] Track request details (sanitized):`, sanitizeForLogging(requestBody));
      throw new ProcessWeaverApiError(data.Errors.ErrorCode, data.Errors.ErrorMessage);
    }

    // Validate response structure
    if (!data.TrackingNumbers || data.TrackingNumbers.length === 0) {
      console.error(`[ProcessWeaver] Invalid tracking response structure. Request (sanitized):`, sanitizeForLogging(requestBody));
      throw new Error("Invalid response: missing TrackingNumbers data");
    }

    const trackingData = data.TrackingNumbers[0];

    const result: TrackResult = {
      trackingNumber: trackingData.TrackingNumber,
      carrier: trackingData.Carrier,
      trackingUrl: trackingData.TrackingUrl,
      events: trackingData.Events.map((event) => ({
        dateTime: event.DateTime,
        status: event.Status,
        location: event.Location,
        deliveryDate: event.Delivery_Date,
      })),
      podSignedBy: trackingData.POD_SignedBy,
      podDocument: trackingData.POD_Document,
    };

    console.log(`[ProcessWeaver] Tracking data retrieved. Status: ${result.events[0]?.status || "Unknown"}`);

    return result;
  } catch (error) {
    if (error instanceof ProcessWeaverApiError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        console.error(`[ProcessWeaver] Tracking request timeout for ${params.trackingNumber}`);
        throw new Error("ProcessWeaver tracking request timed out after 30 seconds");
      }
      console.error(`[ProcessWeaver] Tracking request failed for ${params.trackingNumber}:`, error.message);
      throw new Error(`Failed to track package: ${error.message}`);
    }

    throw new Error("Unknown error occurred while tracking package");
  }
}

// ============================================================================
// Helper: Check Delivery Status
// ============================================================================

/**
 * Check if a package has been delivered based on tracking events
 */
export function isDelivered(trackResult: TrackResult): boolean {
  return trackResult.events.some((event) =>
    event.status.toLowerCase().includes("delivered")
  );
}
