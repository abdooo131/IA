// The packaging shop. Shiply buys packaging from suppliers with purchase orders, keeps it in
// stock, and merchants order it from their panel. A packaging order is delivered like an order,
// for the delivery price in the settings, and paid from the merchant balance or in cash at the door.
import { Injectable } from '@nestjs/common';
import { billShopGoods } from '@shiplynow/db';
import { ACCOUNTS, applyBp } from '@shiplynow/shared/parcels';
import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import { openAlert } from '../agents/alerts';
import { assertMerchantRight, type SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { queueMessage } from '../common/messages';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { post, rawBalance } from '../finance/ledger';
import { revenueLines } from '../finance/postings';

const PHOTO = z.object({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().min(8),
});
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ProductInput = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,30}$/, 'Use 2 to 30 letters, digits or dashes'),
  name: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().max(120).default(''),
  description: z.string().trim().max(500).default(''),
  unit: z.string().trim().max(60).default(''),
  price: z.number().int().min(1).max(100_000_000),
  minStock: z.number().int().min(0).max(1_000_000).default(0),
  active: z.boolean().default(true),
  photo: PHOTO.nullish(),
});
const AdjustInput = z.object({
  qty: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, 'Enter a quantity'),
  note: z.string().trim().min(3, 'Say why the count changed').max(300),
});
const PoLines = z
  .array(
    z.object({
      productId: z.string().min(1).max(64),
      qty: z.number().int().min(1).max(1_000_000),
      unitCost: z.number().int().min(0).max(100_000_000),
    }),
  )
  .min(1)
  .max(100);
const PoInput = z.object({
  supplierId: z.string().min(1).max(64),
  expectedOn: DATE.nullish(),
  notes: z.string().trim().max(500).default(''),
  lines: PoLines,
});
const ReceiveInput = z.object({
  lines: z
    .array(
      z.object({ lineId: z.string().min(1).max(64), qty: z.number().int().min(0).max(1_000_000) }),
    )
    .min(1),
  /** The supplier's invoice for this delivery. */
  number: z.string().trim().max(60).default(''),
  vat: z.boolean().default(true),
  dueDate: DATE.optional(),
});
const OrderInput = z.object({
  lines: z
    .array(
      z.object({ productId: z.string().min(1).max(64), qty: z.number().int().min(1).max(10_000) }),
    )
    .min(1)
    .max(50),
  payment: z.enum(['WALLET', 'CASH']),
  notes: z.string().trim().max(300).default(''),
});
const OutInput = z.object({ courierId: z.string().min(1).max(64) });
const CancelInput = z.object({ reason: z.string().trim().min(3, 'Say why').max(300) });
const DeliverInput = z.object({ code: z.string().trim().max(8).optional() });

const codePurpose = (id: string) => `PACK:${id}`;
const codeHash = (id: string, code: string) =>
  createHash('sha256').update(`${id}:${code}`).digest('hex');

function photoBytes(p: z.infer<typeof PHOTO>) {
  const clean = p.dataBase64.includes(',')
    ? p.dataBase64.slice(p.dataBase64.indexOf(',') + 1)
    : p.dataBase64;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0 || buf.length > 2 * 1024 * 1024)
    throw new DomainError('invalid_input', 'The photo must be under 2 MB', 422);
  return new Uint8Array(buf);
}

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private audit(
    db: Tx | PrismaService,
    user: SessionUser,
    action: string,
    entity: string,
    entityId: string,
    data: object = {},
  ) {
    return db.auditLog.create({
      data: { actorUserId: user.id, action, entityType: entity, entityId, after: data as never },
    });
  }

  // ---------------------------------------------------------------- products and stock

  products(all = true) {
    return this.prisma.packagingProduct.findMany({
      where: all ? {} : { active: true },
      omit: { photo: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async saveProduct(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(ProductInput, body);
    const clash = await this.prisma.packagingProduct.findUnique({ where: { sku: d.sku } });
    if (clash && clash.id !== id) throw new DomainError('duplicate', `Code ${d.sku} is taken`, 409);
    const { photo, ...rest } = d;
    const data = { ...rest, ...(photo ? { photo: photoBytes(photo), photoMime: photo.mime } : {}) };
    const p = id
      ? await this.prisma.packagingProduct
          .update({ where: { id }, data, omit: { photo: true } })
          .catch(() => {
            throw notFound('Product');
          })
      : await this.prisma.packagingProduct.create({ data, omit: { photo: true } });
    await this.audit(
      this.prisma,
      user,
      id ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED',
      'packaging_product',
      p.id,
      { sku: d.sku, price: d.price },
    );
    return p;
  }

  async photo(id: string) {
    const p = await this.prisma.packagingProduct.findUnique({
      where: { id },
      select: { photo: true, photoMime: true, sku: true },
    });
    if (!p?.photo) throw notFound('Photo');
    return { data: p.photo, mime: p.photoMime, name: p.sku };
  }

  /** Counting the shelf: the difference is booked against the stock at the average cost. */
  async adjust(id: string, body: unknown, user: SessionUser) {
    const d = parse(AdjustInput, body);
    return this.prisma.tx(async (tx) => {
      const p = await tx.packagingProduct.findUnique({ where: { id }, omit: { photo: true } });
      if (!p) throw notFound('Product');
      if (p.stock + d.qty < 0)
        throw new DomainError('invalid_input', `Only ${p.stock} in stock`, 422);
      await tx.packagingProduct.update({ where: { id }, data: { stock: { increment: d.qty } } });
      const move = await tx.stockMove.create({
        data: {
          productId: id,
          kind: 'ADJUST',
          qty: d.qty,
          unitCost: p.cost,
          note: d.note,
          userId: user.id,
        },
      });
      const value = Math.abs(d.qty) * p.cost;
      if (value > 0) {
        await post(tx, {
          memo: `Stock count ${p.sku}: ${d.qty > 0 ? '+' : ''}${d.qty}`,
          source: 'STOCK_ADJUST',
          key: `STOCK_ADJUST:${move.id}`,
          userId: user.id,
          lines:
            d.qty > 0
              ? [
                  { account: ACCOUNTS.PACKAGING_STOCK.code, debit: value },
                  { account: ACCOUNTS.OTHER_INCOME.code, credit: value },
                ]
              : [
                  { account: ACCOUNTS.PACKAGING_COST.code, debit: value },
                  { account: ACCOUNTS.PACKAGING_STOCK.code, credit: value },
                ],
        });
      }
      await this.lowStock(tx, id);
      return { stock: p.stock + d.qty };
    });
  }

  moves(productId: string) {
    return this.prisma.stockMove.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  private async lowStock(tx: Tx, productId: string) {
    const p = await tx.packagingProduct.findUniqueOrThrow({
      where: { id: productId },
      select: { id: true, name: true, stock: true, minStock: true },
    });
    if (p.minStock > 0 && p.stock <= p.minStock) {
      await openAlert(tx, {
        kind: 'LOW_STOCK',
        entity: 'packaging_product',
        entityId: p.id,
        message: `${p.name}: ${p.stock} left. Order more from a supplier`,
      });
    } else {
      await tx.networkAlert.updateMany({
        where: { kind: 'LOW_STOCK', entity: 'packaging_product', entityId: p.id, status: 'OPEN' },
        data: { status: 'RESOLVED' },
      });
    }
  }

  // ---------------------------------------------------------------- purchase orders

  purchaseOrders() {
    return this.prisma.shopPurchaseOrder.findMany({
      include: {
        supplier: { select: { name: true } },
        lines: { include: { product: { select: { sku: true, name: true, unit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async suppliers() {
    const rows = await this.prisma.supplier.findMany({
      where: { agent: { is: null } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, isActive: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.isActive }));
  }

  async savePo(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(PoInput, body);
    const sup = await this.prisma.supplier.findUnique({ where: { id: d.supplierId } });
    if (!sup?.isActive) throw new DomainError('invalid_input', 'Pick an active supplier', 422);
    const products = await this.prisma.packagingProduct.count({
      where: { id: { in: d.lines.map((l) => l.productId) } },
    });
    if (products !== new Set(d.lines.map((l) => l.productId)).size)
      throw new DomainError('invalid_input', 'Pick products from the list', 422);
    const net = d.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
    return this.prisma.tx(async (tx) => {
      if (id) {
        const po = await tx.shopPurchaseOrder.findUnique({ where: { id } });
        if (!po) throw notFound('Purchase order');
        if (po.status !== 'DRAFT')
          throw new DomainError('bad_status', 'Only a draft can be changed', 409);
        await tx.shopPurchaseOrderLine.deleteMany({ where: { poId: id } });
        return tx.shopPurchaseOrder.update({
          where: { id },
          data: {
            supplierId: d.supplierId,
            expectedOn: d.expectedOn ?? null,
            notes: d.notes,
            net,
            lines: { create: d.lines },
          },
        });
      }
      const po = await tx.shopPurchaseOrder.create({
        data: {
          code: await nextCode(tx, 'shop_seq', 'PO'),
          supplierId: d.supplierId,
          expectedOn: d.expectedOn ?? null,
          notes: d.notes,
          net,
          createdById: user.id,
          lines: { create: d.lines },
        },
      });
      await this.audit(tx, user, 'PO_CREATED', 'purchase_order', po.id, { net });
      return po;
    });
  }

  async orderPo(id: string, user: SessionUser) {
    const r = await this.prisma.shopPurchaseOrder.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'ORDERED', orderedAt: new Date() },
    });
    if (r.count !== 1)
      throw new DomainError('bad_status', 'Only a draft can be sent to the supplier', 409);
    await this.audit(this.prisma, user, 'PO_ORDERED', 'purchase_order', id);
    return { message: 'Marked as ordered' };
  }

  async cancelPo(id: string, user: SessionUser) {
    const po = await this.prisma.shopPurchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!po) throw notFound('Purchase order');
    if (!['DRAFT', 'ORDERED'].includes(po.status) || po.lines.some((l) => l.receivedQty > 0))
      throw new DomainError('bad_status', 'Goods were already received on this order', 409);
    await this.prisma.shopPurchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit(this.prisma, user, 'PO_CANCELLED', 'purchase_order', id);
    return { message: 'Cancelled' };
  }

  /**
   * Goods arrived. Stock goes up, the average cost moves, and the supplier's bill is raised for
   * what arrived; Accounting pays it like any bill.
   */
  async receive(id: string, body: unknown, user: SessionUser) {
    const d = parse(ReceiveInput, body);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const po = await tx.shopPurchaseOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!po) throw notFound('Purchase order');
      if (po.status !== 'ORDERED')
        throw new DomainError('bad_status', 'Mark the order as sent to the supplier first', 409);
      let net = 0;
      for (const r of d.lines) {
        if (r.qty === 0) continue;
        const line = po.lines.find((l) => l.id === r.lineId);
        if (!line) throw new DomainError('invalid_input', 'A line is not on this order', 422);
        if (line.receivedQty + r.qty > line.qty)
          throw new DomainError(
            'invalid_input',
            `More than ordered on one line (${line.qty - line.receivedQty} left)`,
            422,
          );
        const p = await tx.packagingProduct.findUniqueOrThrow({
          where: { id: line.productId },
          select: { stock: true, cost: true },
        });
        const stock = Math.max(0, p.stock);
        const cost =
          stock + r.qty > 0
            ? Math.round((stock * p.cost + r.qty * line.unitCost) / (stock + r.qty))
            : line.unitCost;
        await tx.packagingProduct.update({
          where: { id: line.productId },
          data: { stock: { increment: r.qty }, cost },
        });
        await tx.shopPurchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQty: { increment: r.qty } },
        });
        await tx.stockMove.create({
          data: {
            productId: line.productId,
            kind: 'PURCHASE',
            qty: r.qty,
            unitCost: line.unitCost,
            ref: po.code,
            userId: user.id,
          },
        });
        await this.lowStock(tx, line.productId);
        net += r.qty * line.unitCost;
      }
      if (net === 0) throw new DomainError('invalid_input', 'Enter what arrived', 422);
      const vat = d.vat ? applyBp(net, s['tax.vat_bp']) : 0;
      // What arrived becomes a supplier bill in Accounting (company Shiply), paid there.
      const deliveries = await tx.stockMove.count({ where: { ref: po.code, kind: 'PURCHASE' } });
      const bill = await billShopGoods(tx, {
        supplierId: po.supplierId,
        reference: d.number ? `${po.code} ${d.number}` : `${po.code}/${deliveries}`,
        netPiastres: net,
        vatPiastres: vat,
        dueDate: d.dueDate ?? null,
        memo: `Goods received on ${po.code}`,
        actorUserId: user.id,
        idempotencyKey: `${po.id}:${deliveries}`,
      });
      const label = `BILL-${String(bill.number).padStart(6, '0')}`;
      const fresh = await tx.shopPurchaseOrderLine.findMany({ where: { poId: id } });
      const done = fresh.every((l) => l.receivedQty >= l.qty);
      await tx.shopPurchaseOrder.update({
        where: { id },
        data: { billId: bill.id, ...(done ? { status: 'RECEIVED', receivedAt: new Date() } : {}) },
      });
      await this.audit(tx, user, 'PO_RECEIVED', 'purchase_order', id, { net, bill: label });
      return {
        message: `Stock updated. Bill ${label} is in Accounting to pay`,
        bill: label,
        complete: done,
      };
    });
  }

  // ---------------------------------------------------------------- the merchant's shop

  async catalog(user: SessionUser) {
    assertMerchantRight(user, 'orders');
    const s = await this.settings.all();
    const items = await this.prisma.packagingProduct.findMany({
      where: { active: true },
      select: {
        id: true,
        sku: true,
        name: true,
        nameAr: true,
        description: true,
        unit: true,
        price: true,
        stock: true,
        photoMime: true,
      },
      orderBy: { name: 'asc' },
    });
    const balance = user.merchantId
      ? -(await rawBalance(this.prisma, ACCOUNTS.MERCHANT_WALLET.code, {
          type: 'MERCHANT',
          id: user.merchantId,
        }))
      : 0;
    return {
      open: s['shop.open'] === 'ON',
      deliveryFee: s['fees.packaging_delivery'],
      freeDeliveryFrom: s['shop.free_delivery_from'],
      balance,
      items: items.map(({ photoMime, stock, ...i }) => ({
        ...i,
        hasPhoto: !!photoMime,
        available: Math.max(0, stock),
      })),
    };
  }

  merchantOrders(user: SessionUser) {
    assertMerchantRight(user, 'orders');
    return this.prisma.packagingOrder.findMany({
      where: { merchantId: user.merchantId! },
      include: {
        lines: { include: { product: { select: { name: true, nameAr: true, unit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Stock is taken when the order is placed, so two merchants never buy the last box twice. */
  async placeOrder(user: SessionUser, body: unknown) {
    assertMerchantRight(user, 'orders');
    const d = parse(OrderInput, body);
    const s = await this.settings.all();
    if (s['shop.open'] !== 'ON')
      throw new DomainError('closed', 'The packaging shop is closed right now', 409);
    const merchantId = user.merchantId!;
    return this.prisma.tx(async (tx) => {
      const m = await tx.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { homeHubId: true, approval: true, isActive: true },
      });
      if (!m.homeHubId)
        throw new DomainError(
          'no_pickup_address',
          'Add your pickup address before ordering packaging',
          422,
        );
      if (!m.isActive || m.approval !== 'approved')
        throw new DomainError('forbidden', 'This merchant account is not active', 403);
      const lines: { productId: string; qty: number; unitPrice: number; unitCost: number }[] = [];
      for (const l of d.lines) {
        const p = await tx.packagingProduct.findUnique({
          where: { id: l.productId },
          select: { active: true, name: true, price: true, cost: true },
        });
        if (!p?.active) throw new DomainError('invalid_input', 'A product is no longer sold', 422);
        // Only take it when enough is left, in one statement.
        const r = await tx.packagingProduct.updateMany({
          where: { id: l.productId, stock: { gte: l.qty } },
          data: { stock: { decrement: l.qty } },
        });
        if (r.count !== 1)
          throw new DomainError('out_of_stock', `Not enough ${p.name} in stock`, 409);
        lines.push({ productId: l.productId, qty: l.qty, unitPrice: p.price, unitCost: p.cost });
      }
      const goodsTotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
      const free = s['shop.free_delivery_from'] > 0 && goodsTotal >= s['shop.free_delivery_from'];
      const deliveryFee = free ? 0 : s['fees.packaging_delivery'];
      const total = goodsTotal + deliveryFee;
      if (d.payment === 'WALLET') {
        const balance = -(await rawBalance(tx, ACCOUNTS.MERCHANT_WALLET.code, {
          type: 'MERCHANT',
          id: merchantId,
        }));
        if (balance < total)
          throw new DomainError(
            'low_balance',
            'Your balance does not cover this order. Choose cash at delivery',
            409,
          );
      }
      const order = await tx.packagingOrder.create({
        data: {
          code: await nextCode(tx, 'shop_seq', 'PK'),
          merchantId,
          hubId: m.homeHubId!,
          payment: d.payment,
          goodsTotal,
          deliveryFee,
          total,
          notes: d.notes,
          placedById: user.id,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      for (const l of lines) {
        await tx.stockMove.create({
          data: {
            productId: l.productId,
            kind: 'SALE',
            qty: -l.qty,
            unitCost: l.unitCost,
            ref: order.code,
            userId: user.id,
          },
        });
        await this.lowStock(tx, l.productId);
      }
      await openAlert(tx, {
        kind: 'PACKAGING_ORDER',
        entity: 'packaging_order',
        entityId: order.id,
        hubId: m.homeHubId,
        message: `Packaging order ${order.code} to prepare`,
      });
      return order;
    });
  }

  async merchantCancel(user: SessionUser, id: string) {
    assertMerchantRight(user, 'orders');
    const o = await this.prisma.packagingOrder.findUnique({ where: { id } });
    if (!o || o.merchantId !== user.merchantId) throw notFound('Order');
    if (o.status !== 'PLACED')
      throw new DomainError(
        'bad_status',
        'This order is already being prepared. Ask support to cancel it',
        409,
      );
    return this.cancelTx(id, 'Cancelled by the merchant', user);
  }

  // ---------------------------------------------------------------- preparing and delivering

  async orders(status?: string, hubId?: string) {
    return this.prisma.packagingOrder
      .findMany({
        where: {
          ...(status
            ? { status: status as never }
            : { status: { in: ['PLACED', 'PACKED', 'OUT'] } }),
          ...(hubId ? { hubId } : {}),
        },
        include: {
          lines: { include: { product: { select: { sku: true, name: true, unit: true } } } },
        },
        orderBy: { createdAt: 'asc' },
        take: 300,
      })
      .then(async (rows) => {
        const [merchants, couriers] = await Promise.all([
          this.prisma.merchant.findMany({
            where: { id: { in: rows.map((r) => r.merchantId) } },
            select: { id: true, name: true, contactPhone: true, pickupAddress: true },
          }),
          this.prisma.user.findMany({
            where: { id: { in: rows.map((r) => r.courierId).filter((x): x is string => !!x) } },
            select: { id: true, name: true },
          }),
        ]);
        return rows.map((r) => ({
          ...r,
          merchant: merchants.find((m) => m.id === r.merchantId) ?? null,
          courier: couriers.find((c) => c.id === r.courierId)?.name ?? '',
        }));
      });
  }

  /** Hub staff only handle the orders of their own facility. */
  async assertOrderHub(id: string, user: SessionUser) {
    if (user.role === 'ADMIN') return;
    const o = await this.prisma.packagingOrder.findUnique({
      where: { id },
      select: { hubId: true },
    });
    if (!o || o.hubId !== user.hubId) throw notFound('Order');
  }

  async pack(id: string, user: SessionUser) {
    const r = await this.prisma.packagingOrder.updateMany({
      where: { id, status: 'PLACED' },
      data: { status: 'PACKED', packedAt: new Date() },
    });
    if (r.count !== 1)
      throw new DomainError('bad_status', 'This order is not waiting to be packed', 409);
    await this.prisma.networkAlert.updateMany({
      where: { kind: 'PACKAGING_ORDER', entityId: id, status: 'OPEN' },
      data: { status: 'RESOLVED' },
    });
    await this.audit(this.prisma, user, 'PACKAGING_PACKED', 'packaging_order', id);
    return { message: 'Packed. Give it to a courier' };
  }

  /** Handed to a courier: the merchant gets the code they give the courier at the door. */
  async sendOut(id: string, body: unknown, user: SessionUser) {
    const d = parse(OutInput, body);
    return this.prisma.tx(async (tx) => {
      const o = await tx.packagingOrder.findUnique({ where: { id } });
      if (!o) throw notFound('Order');
      if (o.status !== 'PACKED') throw new DomainError('bad_status', 'Pack the order first', 409);
      const c = await tx.user.findFirst({
        where: { id: d.courierId, role: 'courier', isActive: true },
      });
      if (!c) throw new DomainError('invalid_input', 'Pick an active courier', 422);
      await tx.packagingOrder.update({
        where: { id },
        data: { status: 'OUT', courierId: c.id, outAt: new Date() },
      });
      await this.sendCode(tx, id);
      await this.audit(tx, user, 'PACKAGING_OUT', 'packaging_order', id, { courierId: c.id });
      return { message: `With ${c.name}. The merchant got the code by SMS` };
    });
  }

  private async sendCode(tx: Tx, id: string) {
    const o = await tx.packagingOrder.findUniqueOrThrow({
      where: { id },
      select: { code: true, merchantId: true },
    });
    const merchant = await tx.merchant.findUniqueOrThrow({
      where: { id: o.merchantId },
      select: { contactPhone: true },
    });
    // No contact phone on the merchant: the owner's (or any active user's) mobile.
    const user = merchant.contactPhone
      ? null
      : await tx.user.findFirst({
          where: { merchantId: o.merchantId, isActive: true, phone: { not: null } },
          orderBy: { createdAt: 'asc' },
          select: { phone: true },
        });
    const m = { contactPhone: merchant.contactPhone ?? user?.phone ?? null };
    const sent = await tx.otpCode.count({
      where: { purpose: codePurpose(id), createdAt: { gte: new Date(Date.now() - 24 * 3600e3) } },
    });
    if (sent >= 3) return false;
    const code = String(randomInt(1000, 10000));
    await tx.otpCode.updateMany({
      where: { purpose: codePurpose(id), usedAt: null },
      data: { expiresAt: new Date() },
    });
    if (!m.contactPhone) return false;
    await tx.otpCode.create({
      data: {
        phone: m.contactPhone,
        purpose: codePurpose(id),
        codeHash: codeHash(id, code),
        expiresAt: new Date(Date.now() + 48 * 3600e3),
      },
    });
    await queueMessage(tx, {
      to: m.contactPhone,
      template: 'PACKAGING_CODE',
      vars: { number: o.code, code },
    });
    return true;
  }

  async cancel(id: string, body: unknown, user: SessionUser) {
    const { reason } = parse(CancelInput, body);
    const o = await this.prisma.packagingOrder.findUnique({ where: { id } });
    if (!o) throw notFound('Order');
    if (!['PLACED', 'PACKED', 'OUT'].includes(o.status))
      throw new DomainError('bad_status', 'This order is closed', 409);
    return this.cancelTx(id, reason, user);
  }

  /** Nothing was booked yet: the stock simply goes back on the shelf. */
  private cancelTx(id: string, reason: string, user: SessionUser) {
    return this.prisma.tx(async (tx) => {
      const o = await tx.packagingOrder.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
      const r = await tx.packagingOrder.updateMany({
        where: { id, status: o.status },
        data: { status: 'CANCELLED', cancelReason: reason },
      });
      if (r.count !== 1)
        throw new DomainError('conflict', 'This order just changed. Try again', 409);
      for (const l of o.lines) {
        await tx.packagingProduct.update({
          where: { id: l.productId },
          data: { stock: { increment: l.qty } },
        });
        await tx.stockMove.create({
          data: {
            productId: l.productId,
            kind: 'CANCELLED_SALE',
            qty: l.qty,
            unitCost: l.unitCost,
            ref: o.code,
            note: reason,
            userId: user.id,
          },
        });
        await this.lowStock(tx, l.productId);
      }
      await tx.networkAlert.updateMany({
        where: { kind: 'PACKAGING_ORDER', entityId: id, status: 'OPEN' },
        data: { status: 'RESOLVED' },
      });
      await this.audit(tx, user, 'PACKAGING_CANCELLED', 'packaging_order', id, { reason });
      return { message: 'Cancelled. The stock is back on the shelf' };
    });
  }

  courierOrders(user: SessionUser) {
    return this.prisma.packagingOrder
      .findMany({
        where: { courierId: user.id, status: 'OUT' },
        include: {
          lines: { include: { product: { select: { name: true, nameAr: true, unit: true } } } },
        },
        orderBy: { outAt: 'asc' },
      })
      .then(async (rows) => {
        const merchants = await this.prisma.merchant.findMany({
          where: { id: { in: rows.map((r) => r.merchantId) } },
          select: { id: true, name: true, contactPhone: true, pickupAddress: true },
        });
        return rows.map((r) => ({ ...r, merchant: merchants.find((m) => m.id === r.merchantId)! }));
      });
  }

  async courierResend(user: SessionUser, id: string) {
    return this.prisma.tx(async (tx) => {
      const o = await tx.packagingOrder.findUnique({ where: { id } });
      if (!o || o.courierId !== user.id || o.status !== 'OUT') throw notFound('Order');
      if (!(await this.sendCode(tx, id)))
        throw new DomainError(
          'rate_limited',
          'Three codes were already sent for this order today',
          429,
        );
      return { message: 'A new code is on its way to the merchant' };
    });
  }

  /**
   * At the merchant: the code from their SMS. The sale books now: goods and delivery as revenue
   * with VAT, taken from the balance or held by the courier as cash, and the cost leaves the stock.
   */
  async deliver(user: SessionUser, id: string, body: unknown) {
    const d = parse(DeliverInput, body);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const o = await tx.packagingOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!o || o.courierId !== user.id) throw notFound('Order');
      if (o.status !== 'OUT')
        throw new DomainError('bad_status', 'This order is not out for delivery', 409);
      const otp = await tx.otpCode.findFirst({
        where: { purpose: codePurpose(id), usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!otp)
        throw new DomainError(
          'code_expired',
          'The code has expired. Send a new one to the merchant',
          422,
        );
      if (otp.attempts >= 5)
        throw new DomainError(
          'code_locked',
          'Too many wrong codes. Send a new one to the merchant',
          422,
        );
      if (!d.code || codeHash(id, d.code) !== otp.codeHash) {
        await tx.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
        throw new DomainError(
          'wrong_code',
          'Wrong code. Ask the merchant for the code in the SMS',
          422,
        );
      }
      await tx.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
      const r = await tx.packagingOrder.updateMany({
        where: { id, status: 'OUT' },
        data: { status: 'DELIVERED', deliveredAt: new Date(), codeChecked: true },
      });
      if (r.count !== 1) throw new DomainError('conflict', 'This order just changed', 409);
      const cost = o.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
      await post(tx, {
        memo: `Packaging ${o.code}`,
        source: 'PACKAGING_SOLD',
        key: `PACKAGING:${o.id}`,
        userId: user.id,
        lines: [
          o.payment === 'CASH'
            ? {
                account: ACCOUNTS.COURIER_CASH.code,
                party: { type: 'COURIER', id: user.id },
                debit: o.total,
              }
            : {
                account: ACCOUNTS.MERCHANT_WALLET.code,
                party: { type: 'MERCHANT', id: o.merchantId },
                debit: o.total,
                memo: 'Packaging order',
              },
          ...revenueLines(s, [
            { account: ACCOUNTS.PACKAGING_SALES.code, amount: o.goodsTotal },
            { account: ACCOUNTS.SHIPPING_REVENUE.code, amount: o.deliveryFee },
          ]),
          ...(cost > 0
            ? [
                { account: ACCOUNTS.PACKAGING_COST.code, debit: cost },
                { account: ACCOUNTS.PACKAGING_STOCK.code, credit: cost },
              ]
            : []),
        ],
      });
      return {
        message:
          o.payment === 'CASH'
            ? `Delivered. You hold ${(o.total / 100).toFixed(2)} EGP for it`
            : 'Delivered',
      };
    });
  }
}
