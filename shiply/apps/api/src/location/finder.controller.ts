import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { extractAddresses, parseAddress, resultsToCsv, summarize } from '@shiply/address';
import { z } from 'zod';
import { NeedAccess, parse } from '../platform';
import { GazetteerCache } from './gazetteer.cache';

/** The address finder: tries addresses without storing anything. */
@Controller('location/find')
export class FinderController {
  constructor(@Inject(GazetteerCache) private readonly cache: GazetteerCache) {}

  @Post()
  @HttpCode(200)
  @NeedAccess('location', 'use')
  async one(@Body() body: unknown) {
    const { address } = parse(z.object({ address: z.string().max(2000) }), body);
    return parseAddress(address, await this.cache.get());
  }

  @Post('bulk')
  @HttpCode(200)
  @NeedAccess('location', 'use')
  async bulk(@Body() body: unknown) {
    const { text } = parse(z.object({ text: z.string().max(20_000_000) }), body);
    const g = await this.cache.get();
    const { addresses, note } = extractAddresses(text);
    const results = addresses.map((a) => parseAddress(a, g));
    return { note, summary: summarize(results), results, csv: resultsToCsv(results) };
  }
}
