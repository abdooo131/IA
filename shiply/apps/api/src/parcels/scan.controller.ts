import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../platform';
import { ScanService } from './scan.service';

const ScanBody = z.object({
  step: z.string().min(1).max(40),
  code: z.string().trim().min(1).max(80),
  deviceScanId: z.string().min(8).max(80),
  siteId: z.string().optional(),
  clientAt: z.coerce.date().optional(),
  bagSeal: z.string().trim().max(80).optional(),
  runId: z.string().optional(),
  pickupId: z.string().optional(),
});

@Controller('parcels')
export class ScanController {
  constructor(@Inject(ScanService) private readonly scans: ScanService) {}

  /** Every scan from a station or a courier phone. Always 200: the answer says green, amber or red. */
  @Post('scan')
  @HttpCode(200)
  scan(@Body() body: unknown, @Req() req: Request) {
    return this.scans.scan(parse(ScanBody, body), req.user!);
  }
}
