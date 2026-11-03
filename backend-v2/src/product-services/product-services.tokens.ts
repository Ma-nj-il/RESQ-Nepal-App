import type { ProductService } from './application/product.service.js';

export const PRODUCT_SERVICE = Symbol('PRODUCT_SERVICE');
export type ProductServiceToken = ProductService;
