export const ORDER_QUERY = `#graphql
  query getOrder($id: ID!) {
    order(id: $id) {
      id
      name
      email
      createdAt
      cancelledAt
      closedAt
      displayFinancialStatus
      displayFulfillmentStatus
      customer {
        id
        firstName
        lastName
        email
      }
      shippingAddress {
        firstName
        lastName
        address1
        address2
        city
        province
        provinceCode
        zip
        country
        countryCode
        phone
        company
      }
      billingAddress {
        firstName
        lastName
        address1
        address2
        city
        province
        provinceCode
        zip
        country
        countryCode
        phone
        company
      }
      metafield(namespace: "custom", key: "serial_numbers") {
        value
      }
      lineItems(first: 250) {
        nodes {
          id
          title
          variantTitle
          sku
          variant {
            id
          }
          product {
            id
            title
            productType
            vendor
            tags
          }
          quantity
          customAttributes {
            key
            value
          }
          image {
            url
            altText
          }
          originalUnitPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          discountedUnitPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
      fulfillments {
        id
        status
        createdAt
        deliveredAt
        updatedAt
        displayStatus
        trackingInfo {
          company
          number
          url
        }
        fulfillmentLineItems(first: 250) {
          nodes {
            id
            lineItem {
              id
            }
            quantity
            originalTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
      returns(first: 50) {
        nodes {
          id
          status
        }
      }
    }
  }
`;

export const ORDERS_SEARCH_QUERY = `#graphql
  query searchOrders($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        name
        email
      }
    }
  }
`;

export const RETURN_CREATE_MUTATION = `#graphql
  mutation returnCreate($returnInput: ReturnInput!) {
    returnCreate(returnInput: $returnInput) {
      return {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const RETURN_REQUEST_MUTATION = `#graphql
  mutation returnRequest($input: ReturnRequestInput!) {
    returnRequest(input: $input) {
      return {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const RETURN_APPROVE_REQUEST_MUTATION = `#graphql
  mutation returnApproveRequest($input: ReturnApproveRequestInput!) {
    returnApproveRequest(input: $input) {
      return {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const RETURN_DECLINE_REQUEST_MUTATION = `#graphql
  mutation returnDeclineRequest($input: ReturnDeclineRequestInput!) {
    returnDeclineRequest(input: $input) {
      return {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const SUGGESTED_REFUND_QUERY = `#graphql
  query suggestedRefund($id: ID!, $refundLineItems: [RefundLineItemInput!]!) {
    order(id: $id) {
      suggestedRefund(refundLineItems: $refundLineItems) {
        amountSet {
          presentmentMoney {
            amount
            currencyCode
          }
        }
        suggestedTransactions {
          parentTransaction {
            id
            gateway
          }
          amountSet {
            presentmentMoney {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

// Shopify Admin API (>=2026-04) requires the @idempotent directive on
// refundCreate to protect against duplicate refunds on network retries.
// The uniqueKey is passed as a variable so the caller can derive a
// deterministic key (e.g. per ReturnRequest id) and benefit from Shopify's
// dedup window — repeated calls with the same key return the cached result
// instead of issuing a second refund.
export const REFUND_CREATE_MUTATION = `#graphql
  mutation refundCreate($input: RefundInput!, $uniqueKey: String!) {
    refundCreate(input: $input) @idempotent(uniqueKey: $uniqueKey) {
      refund {
        id
        totalRefundedSet {
          presentmentMoney {
            amount
            currencyCode
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const DRAFT_ORDER_CREATE_MUTATION = `#graphql
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const DRAFT_ORDER_COMPLETE_MUTATION = `#graphql
  mutation draftOrderComplete($id: ID!, $paymentPending: Boolean) {
    draftOrderComplete(id: $id, paymentPending: $paymentPending) {
      draftOrder {
        id
        order {
          id
          name
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const RETURN_CLOSE_MUTATION = `#graphql
  mutation returnClose($id: ID!) {
    returnClose(id: $id) {
      return {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const RETURN_CANCEL_MUTATION = `#graphql
  mutation returnCancel($id: ID!) {
    returnCancel(id: $id) {
      return {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;
