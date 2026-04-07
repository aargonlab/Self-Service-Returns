// Fetch markets for a shop using the Admin GraphQL API
const MARKETS_QUERY = `#graphql
  query getMarkets {
    markets(first: 50) {
      nodes {
        id
        name
        enabled
        primary
        regions(first: 50) {
          nodes {
            id
            name
            ... on MarketRegionCountry {
              code
            }
          }
        }
      }
    }
  }
`;

export interface ShopifyMarket {
  id: string;
  name: string;
  enabled: boolean;
  primary: boolean;
  regions: Array<{
    id: string;
    name: string;
    code?: string;
  }>;
}

export interface FetchMarketsResult {
  markets: ShopifyMarket[];
  error?: string;
}

export async function fetchMarkets(admin: any): Promise<FetchMarketsResult> {
  try {
    const response = await admin.graphql(MARKETS_QUERY);
    const json = await response.json();

    if (json?.errors?.length) {
      const msg = json.errors.map((e: any) => e.message).join(", ");
      console.error("GraphQL errors fetching markets:", msg);
      return { markets: [], error: msg };
    }

    const markets = json?.data?.markets?.nodes ?? [];
    return {
      markets: markets.map((m: any) => ({
        id: m.id,
        name: m.name,
        enabled: m.enabled,
        primary: m.primary,
        regions: (m.regions?.nodes ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          code: r.code,
        })),
      })),
    };
  } catch (error) {
    console.error("Error fetching markets:", error);
    return { markets: [], error: "Failed to load markets. Make sure the app has the read_markets scope." };
  }
}

// Fetch markets for a shop using unauthenticated admin (for portal routes)
export async function fetchMarketsForShop(shop: string): Promise<ShopifyMarket[]> {
  try {
    const { unauthenticated } = await import("~/shopify.server");
    const { admin } = await unauthenticated.admin(shop);
    const result = await fetchMarkets(admin);
    return result.markets;
  } catch (error) {
    console.error("Error fetching markets for shop:", shop, error);
    return [];
  }
}

// Get market ID from an order by matching shipping/billing country to market regions
export function getMarketFromOrder(order: any, markets?: ShopifyMarket[]): string | null {
  if (!markets || markets.length === 0) {
    return null;
  }

  const countryCode =
    order?.shippingAddress?.countryCode ||
    order?.billingAddress?.countryCode;

  if (!countryCode) return null;

  // Find market whose regions include this country code
  for (const market of markets) {
    if (!market.enabled) continue;
    const match = market.regions.some(
      (region) => region.code === countryCode,
    );
    if (match) return market.id;
  }

  // No matching market found — return null to use global settings
  return null;
}
