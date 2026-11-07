import { type PipeTransform, Injectable } from '@nestjs/common';
import { DomainError } from './errors';

/** Record ids in the merged system are cuid or uuid text. Refuses anything else in a route. */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(value))
      throw new DomainError('invalid_input', 'Not a valid id', 400);
    return value;
  }
}
