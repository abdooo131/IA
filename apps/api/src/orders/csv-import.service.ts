import { BadRequestException, Injectable } from '@nestjs/common';
import { egpToPiastres, OrderType, ORDER_TYPES, PackageSize, PACKAGE_SIZES } from '@shiply/shared';
import { parse as parseCsv } from 'csv-parse/sync';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderSchema } from './orders.schemas';
import { OrderInputError, OrdersService } from './orders.service';

export const CSV_COLUMNS = [
  'customer_name',
  'customer_phone',
  'customer_phone_alt',
  'governorate',
  'area',
  'address',
  'cod_amount',
  'size',
  'type',
  'allow_open_package',
  'items_description',
  'return_items_description',
  'merchant_reference',
  'notes',
  'pickup_location',
] as const;
const REQUIRED = ['customer_name', 'customer_phone', 'governorate', 'area', 'address'];

export interface RowError {
  row: number;
  field: string;
  message: string;
}

const SIZE_ALIASES: Record<string, PackageSize> = {
  small: 'SMALL_MEDIUM', medium: 'SMALL_MEDIUM', 'small/medium': 'SMALL_MEDIUM', s: 'SMALL_MEDIUM', m: 'SMALL_MEDIUM',
  large: 'LARGE', l: 'LARGE', xlarge: 'XLARGE', xl: 'XLARGE', xxl: 'XXL_WHITE_BAG', 'white bag': 'XXL_WHITE_BAG',
  'light bulky': 'LIGHT_BULKY', 'heavy bulky': 'HEAVY_BULKY',
};

export function parseSize(v: string): PackageSize | null | undefined {
  const s = v.trim();
  if (!s) return undefined;
  const up = s.toUpperCase().replace(/[\s/-]+/g, '_');
  if ((PACKAGE_SIZES as readonly string[]).includes(up)) return up as PackageSize;
  return SIZE_ALIASES[s.toLowerCase()] ?? null;
}

export function parseType(v: string): OrderType | null {
  const up = v.trim().toUpperCase();
  if (!up) return 'DELIVER';
  return (ORDER_TYPES as readonly string[]).includes(up) ? (up as OrderType) : null;
}

export function parseBool(v: string): boolean | null | undefined {
  const s = v.trim().toLowerCase();
  if (!s) return undefined;
  if (['yes', 'y', 'true', '1', 'نعم'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'لا'].includes(s)) return false;
  return null;
}

@Injectable()
export class CsvImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  template(): string {
    return (
      CSV_COLUMNS.join(',') +
      '\n' +
      'Mona Adel,01012345678,,CAI,Maadi,"12 Road 9, Maadi",450,Small/Medium,Deliver,yes,Dress size M,,EC-1001,Call before arrival,\n'
    );
  }

  async import(ctx: RequestContext, merchantIdRequested: string | undefined, fileName: string, content: Buffer) {
    const merchantId = this.orders.resolveMerchantId(ctx, merchantIdRequested);
    let records: Record<string, string>[];
    try {
      records = parseCsv(content, {
        columns: (h: string[]) => h.map((c) => c.trim().toLowerCase().replace(/\s+/g, '_')),
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      });
    } catch (e) {
      throw new BadRequestException(`Could not read CSV: ${(e as Error).message}`);
    }
    const maxRows = await this.config.getInt('orders.csv_max_rows');
    if (records.length === 0) throw new BadRequestException('CSV has no data rows');
    if (records.length > maxRows) throw new BadRequestException(`CSV has ${records.length} rows, maximum is ${maxRows}`);
    const header = Object.keys(records[0]);
    const missing = REQUIRED.filter((c) => !header.includes(c));
    if (missing.length) throw new BadRequestException(`Missing required columns: ${missing.join(', ')}`);

    const lookups = await this.prisma.withContext(ctx, async (tx) => ({
      governorates: await tx.governorate.findMany(),
      pickups: await tx.pickupLocation.findMany({ where: { merchantId, archived: false } }),
    }));
    const govByKey = new Map<string, string>();
    for (const g of lookups.governorates) {
      for (const k of [g.code, g.nameEn, g.nameAr]) govByKey.set(k.trim().toLowerCase(), g.code);
    }

    const batch = await this.prisma.withContext(ctx, (tx) =>
      tx.importBatch.create({
        data: { merchantId, fileName, totalRows: records.length, successRows: 0, errorRows: 0, createdById: ctx.userId },
      }),
    );

    const errors: RowError[] = [];
    const created: { row: number; id: string; trackingNumber: string; totalFees: number }[] = [];
    for (let i = 0; i < records.length; i++) {
      const rowNo = i + 2; // header is row 1
      const r = records[i];
      const rowErrors: RowError[] = [];
      const get = (k: string) => (r[k] ?? '').toString();

      const govCode = govByKey.get(get('governorate').toLowerCase());
      if (!govCode) rowErrors.push({ row: rowNo, field: 'governorate', message: `Unknown governorate "${get('governorate')}"` });
      const cod = egpToPiastres(get('cod_amount') || '0');
      if (cod === null) rowErrors.push({ row: rowNo, field: 'cod_amount', message: 'COD must be a positive amount in EGP with up to 2 decimals' });
      const size = parseSize(get('size'));
      if (size === null) rowErrors.push({ row: rowNo, field: 'size', message: `Unknown size "${get('size')}"` });
      const type = parseType(get('type'));
      if (!type) rowErrors.push({ row: rowNo, field: 'type', message: `Type must be Deliver, Exchange or Return` });
      const open = parseBool(get('allow_open_package'));
      if (open === null) rowErrors.push({ row: rowNo, field: 'allow_open_package', message: 'Use yes or no' });
      let pickupLocationId: string | undefined;
      if (get('pickup_location')) {
        const p = lookups.pickups.find((x) => x.name.toLowerCase() === get('pickup_location').toLowerCase());
        if (!p) rowErrors.push({ row: rowNo, field: 'pickup_location', message: `Unknown pickup location "${get('pickup_location')}"` });
        else pickupLocationId = p.id;
      }

      const parsed = CreateOrderSchema.safeParse({
        customerName: get('customer_name'),
        customerPhone: get('customer_phone'),
        customerPhoneAlt: get('customer_phone_alt') || null,
        governorateCode: govCode ?? 'XX',
        area: get('area'),
        addressLine: get('address'),
        codAmount: cod ?? 0,
        size: size ?? undefined,
        type: type ?? 'DELIVER',
        allowOpenPackage: open ?? undefined,
        itemsDescription: get('items_description') || null,
        returnItemsDescription: get('return_items_description') || null,
        merchantReference: get('merchant_reference') || null,
        notes: get('notes') || null,
        pickupLocationId,
      });
      if (!parsed.success) {
        for (const iss of parsed.error.issues) rowErrors.push({ row: rowNo, field: String(iss.path[0]), message: iss.message });
      }
      if (rowErrors.length || !parsed.success) {
        errors.push(...rowErrors);
        continue;
      }
      try {
        // Each row commits on its own so one bad row never blocks the rest of the file.
        const order = await this.prisma.withContext(ctx, (tx) =>
          this.orders.createInTx(tx, ctx, merchantId, parsed.data, 'CSV', batch.id),
        );
        created.push({ row: rowNo, id: order.id, trackingNumber: order.trackingNumber, totalFees: order.totalFees });
      } catch (e) {
        if (e instanceof OrderInputError) errors.push({ row: rowNo, field: e.field, message: e.message });
        else throw e;
      }
    }

    const errorRows = new Set(errors.map((e) => e.row)).size;
    await this.prisma.withContext(ctx, async (tx) => {
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { successRows: created.length, errorRows, errors: errors as unknown as object[] },
      });
      await this.audit.record(tx, ctx, {
        action: 'order.csv_import',
        entityType: 'import_batch',
        entityId: batch.id,
        merchantId,
        after: { fileName, total: records.length, success: created.length, errorRows },
      });
    });
    return { batchId: batch.id, totalRows: records.length, successRows: created.length, errorRows, errors, created };
  }

  async errorReportCsv(ctx: RequestContext, batchId: string): Promise<string> {
    const batch = await this.prisma.withContext(ctx, (tx) => tx.importBatch.findUniqueOrThrow({ where: { id: batchId } }));
    const errs = batch.errors as unknown as RowError[];
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    return ['row,field,message', ...errs.map((e) => `${e.row},${esc(e.field)},${esc(e.message)}`)].join('\n') + '\n';
  }
}
