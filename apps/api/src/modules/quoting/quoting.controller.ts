import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { QuotingService } from "./quoting.service.js";

const QuoteRequestDto = z.object({
  tenantId: z.string().uuid(),
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
  constructor(private readonly quoting: QuotingService) {}

  @Post()
  async create(@Body() body: unknown) {
    const dto = QuoteRequestDto.parse(body);
    // TODO(auth): tenantId and actor come from the Keycloak token once the
    // auth guard lands; accepting them in the body is dev-only.
    return this.quoting.issueQuote({
      ...dto,
      requestedAt: new Date(),
      actor: { kind: "USER", id: "dev", tenantId: dto.tenantId },
    });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    return this.quoting.getQuote(id);
  }
}
