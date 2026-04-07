/**
 * Server-side ProcessWeaver connection test.
 *
 * This is separate from processWeaver.server.ts to provide
 * a lightweight connection test without importing the full client.
 */

import { validateExternalUrl } from "~/utils/validators";

export interface TestConnectionParams {
  shipEndpoint: string;
  apiKey: string;
  environment: "TEST" | "PROD";
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  responseTimeMs: number;
}

/**
 * Test the ProcessWeaver connection by sending a minimal Ship API request.
 * Uses intentionally incomplete data so the API will respond with a validation
 * error (not a label), but proves the endpoint is reachable and the API key works.
 *
 * Possible outcomes:
 * - Endpoint unreachable (DNS/network failure) → success: false
 * - Endpoint reachable, API responds (even with validation error) → success: true
 * - Timeout → success: false
 */
export async function testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
  const start = Date.now();

  // Minimal payload — enough for the API to authenticate and respond
  const testPayload = {
    APIKey: params.apiKey,
    ENV: params.environment,
    LabelFormat: "PNG",
    CarrierDetails: {
      AccountNumber: "TEST",
      Carrier: "TEST",
      ServiceType: "TEST",
      Password: "",
      UserID: "",
      MeterNumber: "",
      ShipDate: new Date().toISOString().split("T")[0],
      CustomerTransactionId: "connection-test",
    },
    ShipFrom: {
      City: "Test", CompanyName: "Test", Contact: "Test",
      CountryCode: "US", PostalCode: "00000", StateOrProvinceCode: "CA",
      StreetLine1: "123 Test St", Phone: "0000000000",
    },
    ShipTo: {
      City: "Test", CompanyName: "Test", Contact: "Test",
      CountryCode: "US", PostalCode: "00000", StateOrProvinceCode: "CA",
      StreetLine1: "456 Test Ave", Phone: "0000000000",
    },
    Paymentinformation: { PayerAccountNumber: "TEST", PaymentType: "SENDER" },
    PackageCount: "1",
    TotalWeight: "1",
    Packagedetails: [{ WeightValue: "1", WeightUnits: "KGS", Length: "10", Width: "10", Height: "10", DimensionUnit: "CM" }],
    SpecialServices: { ReturnShipmentDetail: { ReturnShipment: false, ReturnType: "PRINT_RETURN_LABEL" } },
  };

  try {
    // SSRF protection: validate endpoint URL
    validateExternalUrl(params.shipEndpoint, "ProcessWeaver test endpoint");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(params.shipEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const elapsed = Date.now() - start;

    // Any HTTP response means the endpoint is reachable
    if (response.ok || response.status < 500) {
      try {
        const data = await response.json() as { Errors?: { ErrorCode: string; ErrorMessage: string } };
        if (data.Errors) {
          return {
            success: true,
            message: `Connection successful (API responded in ${elapsed}ms). API validation: ${data.Errors.ErrorMessage}`,
            responseTimeMs: elapsed,
          };
        }
        return {
          success: true,
          message: `Connection successful (${elapsed}ms)`,
          responseTimeMs: elapsed,
        };
      } catch {
        return {
          success: true,
          message: `Endpoint reachable (HTTP ${response.status}, ${elapsed}ms) but response is not valid JSON. Verify this is the correct ProcessWeaver API URL.`,
          responseTimeMs: elapsed,
        };
      }
    }

    return {
      success: false,
      message: `Server error: HTTP ${response.status} ${response.statusText} (${elapsed}ms)`,
      responseTimeMs: elapsed,
    };
  } catch (error) {
    const elapsed = Date.now() - start;

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          message: `Connection timed out after 10 seconds. The endpoint may be unreachable.`,
          responseTimeMs: elapsed,
        };
      }

      const msg = error.message;
      if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo") || msg.includes("NXDOMAIN")) {
        return {
          success: false,
          message: `DNS resolution failed — the hostname does not exist. Please verify the endpoint URL.`,
          responseTimeMs: elapsed,
        };
      }
      if (msg.includes("ECONNREFUSED")) {
        return {
          success: false,
          message: `Connection refused — the server is not accepting connections on this port.`,
          responseTimeMs: elapsed,
        };
      }

      return {
        success: false,
        message: `Connection failed: ${msg}`,
        responseTimeMs: elapsed,
      };
    }

    return {
      success: false,
      message: "Unknown error during connection test",
      responseTimeMs: Date.now() - start,
    };
  }
}
