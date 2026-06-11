// product.ts — product paragraph parsing API for StructMigrate Screen 02.

import { structPost } from './client';
import type { ProductParseRequest, ProductParseResponse } from './types';

export function parseProduct(body: ProductParseRequest): Promise<ProductParseResponse> {
  return structPost<ProductParseResponse>('/api/struct/product/parse', body);
}
