/**
 * Every Admin GraphQL operation the app uses, in one place. Fields were checked against
 * the 2026-10 Admin schema. Inventory mutations need an @idempotent key since 2026-04.
 */

export const SHOP_INFO = /* GraphQL */ `
  query ShopInfo {
    shop {
      name
      myshopifyDomain
      currencyCode
    }
  }
`;

/** The shop's fulfillment services, to take over ours left from an earlier install. */
export const FULFILLMENT_SERVICES = /* GraphQL */ `
  query FulfillmentServices {
    shop {
      fulfillmentServices {
        id
        serviceName
        callbackUrl
        location {
          id
        }
      }
    }
  }
`;

export const FULFILLMENT_SERVICE_UPDATE = /* GraphQL */ `
  mutation FulfillmentServiceUpdate($id: ID!, $callbackUrl: URL!) {
    fulfillmentServiceUpdate(id: $id, callbackUrl: $callbackUrl) {
      fulfillmentService {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const FULFILLMENT_SERVICE_CREATE = /* GraphQL */ `
  mutation FulfillmentServiceCreate($name: String!, $callbackUrl: URL!) {
    fulfillmentServiceCreate(
      name: $name
      callbackUrl: $callbackUrl
      inventoryManagement: true
      trackingSupport: true
      requiresShippingMethod: true
    ) {
      fulfillmentService {
        id
        location {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FULFILLMENT_ORDER_FIELDS = /* GraphQL */ `
  id
  status
  requestStatus
  assignedLocation {
    location {
      id
    }
  }
  destination {
    firstName
    lastName
    phone
    address1
    address2
    city
    province
  }
  order {
    id
    name
    phone
    note
    totalOutstandingSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    shippingAddress {
      name
      phone
      address1
      address2
      city
      province
      latitude
      longitude
    }
    shippingLines(first: 5) {
      nodes {
        title
        code
        discountedPriceSet {
          shopMoney {
            amount
          }
        }
      }
    }
  }
  lineItems(first: 100) {
    nodes {
      id
      sku
      remainingQuantity
      totalQuantity
      variant {
        id
      }
      lineItem {
        id
        sku
        discountedUnitPriceAfterAllDiscountsSet {
          shopMoney {
            amount
          }
        }
      }
    }
  }
`;

export const ASSIGNED_FULFILLMENT_ORDERS = /* GraphQL */ `
  query AssignedFulfillmentOrders($status: FulfillmentOrderAssignmentStatus!, $locationIds: [ID!], $after: String) {
    assignedFulfillmentOrders(first: 25, assignmentStatus: $status, locationIds: $locationIds, after: $after) {
      nodes {
        ${FULFILLMENT_ORDER_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const ACCEPT_FULFILLMENT_REQUEST = /* GraphQL */ `
  mutation AcceptFulfillmentRequest($id: ID!, $message: String) {
    fulfillmentOrderAcceptFulfillmentRequest(id: $id, message: $message) {
      fulfillmentOrder {
        id
        status
        requestStatus
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const REJECT_FULFILLMENT_REQUEST = /* GraphQL */ `
  mutation RejectFulfillmentRequest(
    $id: ID!
    $reason: FulfillmentOrderRejectionReason
    $message: String
  ) {
    fulfillmentOrderRejectFulfillmentRequest(id: $id, reason: $reason, message: $message) {
      fulfillmentOrder {
        id
        status
        requestStatus
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ACCEPT_CANCELLATION_REQUEST = /* GraphQL */ `
  mutation AcceptCancellationRequest($id: ID!, $message: String) {
    fulfillmentOrderAcceptCancellationRequest(id: $id, message: $message) {
      fulfillmentOrder {
        id
        status
        requestStatus
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const REJECT_CANCELLATION_REQUEST = /* GraphQL */ `
  mutation RejectCancellationRequest($id: ID!, $message: String) {
    fulfillmentOrderRejectCancellationRequest(id: $id, message: $message) {
      fulfillmentOrder {
        id
        status
        requestStatus
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const FULFILLMENT_CREATE = /* GraphQL */ `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
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

export const FULFILLMENT_EVENT_CREATE = /* GraphQL */ `
  mutation FulfillmentEventCreate($fulfillmentEvent: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
      fulfillmentEvent {
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

export const ORDER_EDIT_BEGIN = /* GraphQL */ `
  mutation OrderEditBegin($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder {
        id
        lineItems(first: 100) {
          nodes {
            id
            sku
            quantity
            variant {
              id
            }
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

export const ORDER_EDIT_SET_QUANTITY = /* GraphQL */ `
  mutation OrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
    orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: false) {
      calculatedOrder {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ORDER_EDIT_COMMIT = /* GraphQL */ `
  mutation OrderEditCommit($id: ID!, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: true, staffNote: $staffNote) {
      order {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_VARIANTS = /* GraphQL */ `
  query ProductVariants($after: String) {
    productVariants(first: 100, after: $after) {
      nodes {
        id
        sku
        barcode
        price
        title
        inventoryItem {
          id
        }
        product {
          id
          title
          status
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const INVENTORY_ACTIVATE = /* GraphQL */ `
  mutation InventoryActivate(
    $inventoryItemId: ID!
    $locationId: ID!
    $available: Int
    $key: String!
  ) {
    inventoryActivate(
      inventoryItemId: $inventoryItemId
      locationId: $locationId
      available: $available
    ) @idempotent(key: $key) {
      inventoryLevel {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const INVENTORY_SET_QUANTITIES = /* GraphQL */ `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!, $key: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $key) {
      inventoryAdjustmentGroup {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/** The checkout rate service: Shopify asks it for rates on every checkout of the shop. */
export const CARRIER_SERVICE_CREATE = /* GraphQL */ `
  mutation CarrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** Gives a fulfillment service location the dark store's real address. */
export const LOCATION_EDIT = /* GraphQL */ `
  mutation LocationEdit($id: ID!, $input: LocationEditInput!) {
    locationEdit(id: $id, input: $input) {
      location {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** The shop's webhook subscriptions made by this app (registered per shop at install). */
export const WEBHOOK_SUBSCRIPTIONS = /* GraphQL */ `
  query WebhookSubscriptions {
    webhookSubscriptions(first: 50) {
      nodes {
        id
        topic
        uri
      }
    }
  }
`;

export const WEBHOOK_SUBSCRIPTION_CREATE = /* GraphQL */ `
  mutation WebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const WEBHOOK_SUBSCRIPTION_UPDATE = /* GraphQL */ `
  mutation WebhookSubscriptionUpdate($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** Removes one of our fulfillment services (and its location, with the stock we reported). */
export const FULFILLMENT_SERVICE_DELETE = /* GraphQL */ `
  mutation FulfillmentServiceDelete($id: ID!) {
    fulfillmentServiceDelete(id: $id, inventoryAction: DELETE) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

/** Removes the checkout rate service. */
export const CARRIER_SERVICE_DELETE = /* GraphQL */ `
  mutation CarrierServiceDelete($id: ID!) {
    carrierServiceDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── merchant store data (bulk exports) ─────────────────────────────────────────

const updatedSince = (since?: Date) =>
  since ? `(query: "updated_at:>'${since.toISOString()}'")` : '';

/** Every product with its variants; with `since`, only those changed after it. */
export function productsExport(since?: Date) {
  return `{
  products${updatedSince(since)} {
    edges { node {
      id title handle status vendor productType tags createdAt updatedAt publishedAt totalInventory
      category { id fullName }
      featuredMedia { preview { image { url } } }
      mediaCount { count }
      variants { edges { node {
        id title sku barcode price compareAtPrice inventoryQuantity createdAt updatedAt
        selectedOptions { name value }
        inventoryItem { id unitCost { amount } measurement { weight { value unit } } }
      } } }
    } }
  }
}`;
}

/** Stock of every item at every location (the merchant's warehouses and our dark stores). */
export function inventoryExport() {
  return `{
  inventoryItems {
    edges { node {
      id sku
      inventoryLevels { edges { node {
        id location { id name }
        quantities(names: ["available", "on_hand", "committed", "incoming"]) { name quantity }
      } } }
    } }
  }
}`;
}

/**
 * How much of the buyer an order export reads. "full": contact details and the delivery
 * address; "contact" (Shopify refused contact details): governorate and city only;
 * "addresses" (Shopify refused addresses too): nothing about the buyer.
 */
export type OrderDetail = 'full' | 'contact' | 'addresses';

const ORDER_FIELDS = (detail: OrderDetail) => `
  id name createdAt processedAt updatedAt cancelledAt test
  displayFinancialStatus displayFulfillmentStatus currencyCode sourceName tags
  subtotalLineItemsQuantity currentSubtotalLineItemsQuantity
  subtotalPriceSet { shopMoney { amount } }
  totalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalPriceSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  ${
    detail === 'full'
      ? `email phone
  customer { id firstName lastName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
  shippingAddress { name phone address1 address2 province city countryCodeV2 }`
      : detail === 'contact'
        ? 'shippingAddress { province city countryCodeV2 }'
        : ''
  }`;

const LINE_FIELDS = `
  id name sku vendor quantity currentQuantity
  originalUnitPriceSet { shopMoney { amount } }
  totalDiscountSet { shopMoney { amount } }
  product { id } variant { id }`;

/**
 * Every order with its lines, and as much of the buyer as `detail` allows (see OrderDetail).
 */
export function ordersExport(since: Date | undefined, detail: OrderDetail) {
  return `{
  orders${updatedSince(since)} {
    edges { node {
      ${ORDER_FIELDS(detail)}
      lineItems { edges { node { ${LINE_FIELDS} } } }
    } }
  }
}`;
}

const CUSTOMER_FIELDS = `
  id firstName lastName state tags createdAt updatedAt numberOfOrders
  amountSpent { amount }
  defaultEmailAddress { emailAddress marketingState }
  defaultPhoneNumber { phoneNumber marketingState }
  defaultAddress { address1 address2 city province phone }`;

/** Every customer record of the store with contact details, consent, address and totals. */
export function customersExport(since: Date | undefined) {
  return `{
  customers${updatedSince(since)} {
    edges { node { ${CUSTOMER_FIELDS} } }
  }
}`;
}

/** One customer, for the customers/create and customers/update webhooks. */
export const CUSTOMER_FOR_DATA = `query CustomerForData($id: ID!) {
  customer(id: $id) { ${CUSTOMER_FIELDS} }
}`;

/** One order, for the orders/create and orders/updated webhooks. */
export function orderForData(detail: OrderDetail) {
  return `query OrderForData($id: ID!) {
  order(id: $id) {
    ${ORDER_FIELDS(detail)}
    lineItems(first: 250) { nodes { ${LINE_FIELDS} } }
  }
}`;
}

export const BULK_RUN = /* GraphQL */ `
  mutation BulkRun($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
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

export const BULK_STATUS = /* GraphQL */ `
  query BulkStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        objectCount
        url
        partialDataUrl
      }
    }
  }
`;

/** The store itself: name, plan, currency, age, and its locations. */
export const SHOP_PROFILE = /* GraphQL */ `
  query ShopProfile {
    shop {
      id
      name
      myshopifyDomain
      currencyCode
      createdAt
      ianaTimezone
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
      primaryDomain {
        host
      }
      billingAddress {
        city
        countryCodeV2
      }
    }
    productsCount {
      count
    }
    locations(first: 100) {
      nodes {
        id
        name
        isActive
        fulfillsOnlineOrders
        address {
          city
          province
          countryCode
        }
      }
    }
  }
`;
