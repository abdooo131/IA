"""GraphQL queries used by the sync. Bulk queries return JSONL where nested rows carry __parentId."""
from __future__ import annotations


def _filter(since_iso: str | None) -> str:
    return f'(query: "updated_at:>=\'{since_iso}\'")' if since_iso else ""


def orders_bulk(since_iso: str | None = None) -> str:
    return """
{
  orders%s {
    edges { node {
      id name createdAt processedAt updatedAt cancelledAt cancelReason
      displayFinancialStatus displayFulfillmentStatus sourceName tags discountCodes test
      totalDiscountsSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      shippingAddress { city province }
      customer { id }
      refunds { id createdAt }
      lineItems { edges { node {
        id sku quantity currentQuantity unfulfilledQuantity
        variant { id }
        product { id }
        originalUnitPriceSet { shopMoney { amount } }
        discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
        totalDiscountSet { shopMoney { amount } }
      } } }
    } }
  }
}
""" % _filter(since_iso)


def products_bulk(since_iso: str | None = None) -> str:
    return """
{
  products%s {
    edges { node {
      id title productType vendor tags status createdAt publishedAt updatedAt
      collections { edges { node { id title } } }
    } }
  }
}
""" % _filter(since_iso)


# Variants are pulled in full every run because inventory changes do not move updated_at,
# and the daily inventory and price snapshots need every variant.
VARIANTS_BULK = """
{
  productVariants {
    edges { node {
      id sku title barcode price compareAtPrice inventoryPolicy createdAt updatedAt
      selectedOptions { name value }
      product { id }
      inventoryItem {
        id
        unitCost { amount }
        inventoryLevels { edges { node {
          id
          location { id }
          quantities(names: ["available", "committed", "incoming", "on_hand"]) { name quantity }
        } } }
      }
    } }
  }
}
"""

LOCATIONS = """
query locations($cursor: String) {
  locations(first: 100, after: $cursor, includeInactive: true) {
    edges { node { id name isActive } }
    pageInfo { hasNextPage endCursor }
  }
}
"""

REFUND_DETAILS = """
query refunds($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      refunds {
        id createdAt
        refundLineItems(first: 100) { edges { node {
          quantity restockType
          subtotalSet { shopMoney { amount } }
          lineItem { id }
        } } }
      }
    }
  }
}
"""
