import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { RequestContext } from '../common/context';
import { Ctx, Roles } from '../common/decorators';
import { MERCHANT, ORDER_STAFF, ORDER_WRITERS } from '../common/roles';
import { parse } from '../common/zod';
import { ConfigService } from '../config/config.service';
import { LabelService } from '../labels/label.service';
import { PrismaService } from '../prisma/prisma.service';
import { CsvImportService } from './csv-import.service';
import { CreateOrderSchema, IdsSchema, ListOrdersSchema, TransitionSchema } from './orders.schemas';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly csv: CsvImportService,
    private readonly labels: LabelService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @Roles(...MERCHANT, ...ORDER_WRITERS)
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.orders.create(ctx, parse(CreateOrderSchema, body));
  }

  @Get()
  @Roles(...MERCHANT, ...ORDER_STAFF)
  list(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.orders.list(ctx, parse(ListOrdersSchema, query));
  }

  @Get('dashboard')
  @Roles(...MERCHANT, ...ORDER_STAFF)
  dashboard(@Ctx() ctx: RequestContext, @Query('merchantId') merchantId?: string) {
    return this.orders.dashboard(ctx, ctx.merchantId ?? merchantId);
  }

  @Get('import/template')
  @Roles(...MERCHANT, ...ORDER_WRITERS)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="shiply-orders-template.csv"')
  template() {
    return this.csv.template();
  }

  @Post('import')
  @Roles(...MERCHANT, ...ORDER_WRITERS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  import(@Ctx() ctx: RequestContext, @UploadedFile() file: Express.Multer.File | undefined, @Body('merchantId') merchantId?: string) {
    if (!file) throw new BadRequestException('Upload a CSV file in the "file" field');
    return this.csv.import(ctx, merchantId, file.originalname, file.buffer);
  }

  @Get('import/:batchId/errors.csv')
  @Roles(...MERCHANT, ...ORDER_WRITERS)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  errors(@Ctx() ctx: RequestContext, @Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.csv.errorReportCsv(ctx, batchId);
  }

  @Post('labels')
  @Roles(...MERCHANT, ...ORDER_WRITERS)
  async bulkLabels(@Ctx() ctx: RequestContext, @Body() body: unknown, @Res() res: Response) {
    const { ids } = parse(IdsSchema, body);
    await this.sendLabels(ctx, ids, res);
  }

  @Get(':id/label')
  @Roles(...MERCHANT, ...ORDER_WRITERS)
  async label(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    await this.sendLabels(ctx, [id], res);
  }

  @Get(':id')
  @Roles(...MERCHANT, ...ORDER_STAFF)
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.orders.get(ctx, id);
  }

  @Post(':id/transition')
  @Roles(...MERCHANT, ...ORDER_WRITERS)
  transition(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(TransitionSchema, body);
    return this.orders.transition(ctx, id, b.to, b.note);
  }

  private async sendLabels(ctx: RequestContext, ids: string[], res: Response) {
    const pdf = await this.prisma.withContext(
      ctx,
      async (tx) => {
        const rows = await tx.order.findMany({
          where: { id: { in: ids } },
          include: { merchant: true, governorate: true, destinationHub: true, pickupLocation: true },
          orderBy: { createdAt: 'asc' },
        });
        if (rows.length !== ids.length) throw new BadRequestException('Some orders were not found');
        const base = await this.config.getString('tracking.public_base_url', tx);
        const buf = await this.labels.render(rows, base);
        await this.orders.markPrinted(tx, ctx, ids);
        return buf;
      },
      { timeout: 60000 },
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="awb-${ids.length === 1 ? ids[0] : 'bulk'}.pdf"`);
    res.send(pdf);
  }
}
