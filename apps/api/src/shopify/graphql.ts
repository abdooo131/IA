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
