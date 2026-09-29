import { Router } from 'express';
import type { Container } from '../../container';
import { ProductController } from './product.controller';

export function productRoutes({ products }: Container): Router {
  const controller = new ProductController(products);
  const router = Router();
  router.get('/', controller.list);
  router.get('/:id', controller.getOne);
  router.get('/:id/stock', controller.getStock);
  return router;
}
