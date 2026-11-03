import { Module } from '@nestjs/common';

import {
  IDEMPOTENCY_EXECUTOR,
  type IdempotencyExecutor,
} from '../shared/application/idempotency/idempotency.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../shared/application/persistence/unit-of-work.js';
import { ID_GENERATOR, type IdGenerator } from '../shared/domain/id-generator.js';
import { ProductService } from './application/product.service.js';
import {
  PRODUCT_REPOSITORY,
  PRODUCT_CONTENT_PROTECTOR,
  type ProductRepository,
  type ContentProtector,
} from './application/ports/product.repository.js';
import { AesSupportContentProtector } from './infrastructure/aes-support-content.protector.js';
import { PostgresProductRepository } from './infrastructure/postgres-product.repository.js';
import { RequesterProductController } from './presentation/http/requester-product.controller.js';
import {
  TenantProductController,
  AuthoritySupportController,
} from './presentation/http/managed-product.controller.js';
import { PRODUCT_SERVICE } from './product-services.tokens.js';

@Module({
  controllers: [RequesterProductController, TenantProductController, AuthoritySupportController],
  providers: [
    PostgresProductRepository,
    { provide: PRODUCT_REPOSITORY, useExisting: PostgresProductRepository },
    AesSupportContentProtector,
    { provide: PRODUCT_CONTENT_PROTECTOR, useExisting: AesSupportContentProtector },
    {
      provide: PRODUCT_SERVICE,
      inject: [
        PRODUCT_REPOSITORY,
        UNIT_OF_WORK,
        IDEMPOTENCY_EXECUTOR,
        PRODUCT_CONTENT_PROTECTOR,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: ProductRepository,
        unitOfWork: UnitOfWork,
        idempotency: IdempotencyExecutor,
        content: ContentProtector,
        ids: IdGenerator,
      ): ProductService => new ProductService(repository, unitOfWork, idempotency, content, ids),
    },
  ],
  exports: [PRODUCT_SERVICE],
})
export class ProductServicesModule {}
