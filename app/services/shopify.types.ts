export interface ShopifyLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  variant: {
    id: string;
  } | null;
  product?: {
    id: string;
    title: string;
    productType: string | null;
    vendor: string | null;
    tags: string[];
  } | null;
  quantity: number;
  customAttributes: Array<{
    key: string;
    value: string | null;
  }>;
  image: {
    url: string;
    altText: string | null;
  } | null;
  originalUnitPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  discountedUnitPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
}

export interface ShopifyFulfillmentLineItem {
  id: string;
  lineItem: {
    id: string;
  };
  quantity: number;
  originalTotalSet?: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
}

export interface ShopifyFulfillment {
  id: string;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  updatedAt: string;
  displayStatus: string | null;
  trackingInfo: Array<{
    company: string | null;
    number: string | null;
    url: string | null;
  }>;
  fulfillmentLineItems?: {
    nodes: ShopifyFulfillmentLineItem[];
  };
}

export interface ShopifyFulfillmentOrderLineItem {
  id: string;
  lineItem: {
    id: string;
  };
  totalQuantity: number;
  remainingQuantity: number;
}

export interface ShopifyFulfillmentOrder {
  id: string;
  status: string;
  lineItems: {
    nodes: ShopifyFulfillmentOrderLineItem[];
  };
}

export interface ShopifyReturnLineItem {
  id: string;
  quantity: number;
  fulfillmentLineItem?: {
    id: string;
    lineItem: {
      id: string;
    };
  } | null;
}

export interface ShopifyAddress {
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  zip: string | null;
  country: string | null;
  countryCode: string | null;
  phone: string | null;
  company: string | null;
}

export interface ShopifyOrder {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  cancelledAt?: string | null;
  closedAt?: string | null;
  currencyCode?: string;
  presentmentCurrencyCode?: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  shippingAddress: ShopifyAddress | null;
  billingAddress: ShopifyAddress | null;
  metafield?: {
    value: string;
  } | null;
  lineItems: {
    nodes: ShopifyLineItem[];
  };
  fulfillments: ShopifyFulfillment[];
  fulfillmentOrders?: {
    nodes: ShopifyFulfillmentOrder[];
  };
  returns: {
    nodes: Array<{
      id: string;
      status: string;
    }>;
  };
}

export interface EligibleItem {
  lineItemId: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  variantId: string | null;
  imageUrl: string | null;
  price: string;
  currencyCode: string;
  totalQuantity: number;
  alreadyReturnedQuantity: number;
  returnableQuantity: number;
  /** Whether price data was available from Shopify (false means price fell back to "0"). */
  priceAvailable?: boolean;
  /** When RX grouping is enabled, contains the IDs of all line items in this group (including the primary). */
  groupedLineItemIds?: string[];
  /** When RX grouping is enabled, contains the product titles of grouped items (e.g. lenses). */
  groupedItemTitles?: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  eligibleItems: EligibleItem[];
  reasons: string[];
  order: ShopifyOrder;
  warnings?: string[];
  windowExpired?: boolean;
  effectiveWindowDays?: number;
  daysSinceFulfillment?: number;
}
