import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { BookingsService } from "./bookings.service.js";

const BookQuoteDto = z.object({
  carrierBookingRef: z.string().min(1).max(64).optional(),
});

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post("quotes/:id/book")
  async bookQuote(
    @Param("id", ParseUUIDPipe) quoteId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = BookQuoteDto.parse(body ?? {});
    return this.bookings.bookQuote({
      quoteId,
      tenantId: auth.tenantId,
      carrierBookingRef: dto.carrierBookingRef,
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
  }

  @Get("shipments/:id")
  async getShipment(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.bookings.getShipment(id, auth.tenantId);
  }
}
