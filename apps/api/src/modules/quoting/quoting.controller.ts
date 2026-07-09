import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { QuotePdfService } from "./quote-pdf.service.js";
import { QuotingService } from "./quoting.service.js";

const QuoteRequestDto = z.object({
  customerId: z.string().uuid(),
  origin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
  destination: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
  mode: z.enum(["OCEAN", "AIR", "ROAD", "RAIL"]),
  containerType: z
    .enum(["20GP", "40GP", "40HC", "45HC", "20RF", "40RF", "LCL"])
    .nullable()
    .default(null),
  quantity: z.number().int().positive().default(1),
  incoterm: z.enum([
    "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP",
  ]),
  validityDays: z.number().int().positive().max(90).optional(),
});

@Controller("quotes")
export class QuotingController {
  constructor(
    @Inject(QuotingService) private readonly quoting: QuotingService,
    @Inject(QuotePdfService) private readonly pdf: QuotePdfService,
  ) {}

  @Post()
  async create(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const dto = QuoteRequestDto.parse(body);
    return this.quoting.issueQuote({
      ...dto,
      tenantId: auth.tenantId,
      requestedAt: new Date(),
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
  }

  @Get(":id")
  async get(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.quoting.getQuote(id, auth.tenantId);
  }

  @Get(":id/pdf")
  async getPdf(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
  ) {
    const data = await this.quoting.getQuotePdfData(id, auth.tenantId);
    const buffer = await this.pdf.render(data);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="quote-${id}.pdf"`);
    res.send(buffer);
  }
}
