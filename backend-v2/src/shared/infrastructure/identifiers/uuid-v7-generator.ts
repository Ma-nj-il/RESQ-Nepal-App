import { Injectable } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';

import type { IdGenerator } from '../../domain/id-generator.js';

@Injectable()
export class UuidV7Generator implements IdGenerator {
  generate(): string {
    return uuidv7();
  }
}
