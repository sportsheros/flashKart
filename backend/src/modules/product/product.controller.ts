import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ProductService } from './product.service';

const idParam = z.object({ id: z.string().uuid() });

// serverTime lets the client compute its clock offset; countdowns must not trust the device clock
const now = () => new Date().toISOString();

export class ProductController {
  constructor(private readonly products: ProductService) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    res.json({ serverTime: now(), products: await this.products.list() });
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = idParam.parse(req.params);
    res.json({ serverTime: now(), product: await this.products.getOne(id) });
  };

  getStock = async (req: Request, res: Response): Promise<void> => {
    const { id } = idParam.parse(req.params);
    const stock = await this.products.getStock(id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ serverTime: now(), productId: id, stock });
  };
}
