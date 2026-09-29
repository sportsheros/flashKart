import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUserId } from '../../middleware/auth';
import type { ReservationService } from './reservation.service';

export const reserveBodySchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
});

const reservationParams = z.object({ reservationId: z.string().uuid() });

export class CartController {
  constructor(private readonly reservations: ReservationService) {}

  reserve = async (req: Request, res: Response): Promise<void> => {
    const { productId, quantity } = req.body as z.infer<typeof reserveBodySchema>;
    const reservation = await this.reservations.reserve(currentUserId(req), productId, quantity);
    res.status(201).json({ serverTime: new Date().toISOString(), ...reservation });
  };

  getReservation = async (req: Request, res: Response): Promise<void> => {
    const { reservationId } = reservationParams.parse(req.params);
    const reservation = await this.reservations.getReservation(currentUserId(req), reservationId);
    res.json({ serverTime: new Date().toISOString(), ...reservation });
  };
}
