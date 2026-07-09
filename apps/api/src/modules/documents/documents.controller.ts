import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { DocumentsService } from "./documents.service.js";

const UploadDto = z.object({
  docType: z.enum([
    "COMMERCIAL_INVOICE",
    "PACKING_LIST",
    "BL",
    "SAD500",
    "CERTIFICATE_OF_ORIGIN",
    "CLEARING_INSTRUCTION",
    "POD",
    "OTHER",
  ]),
  shipmentId: z.string().uuid().optional(),
});

const ReviewDto = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  correctedData: z.record(z.unknown()).optional(),
});

@Controller("documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 32 * 1024 * 1024 } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = UploadDto.parse(body);
    return this.documents.upload({
      tenantId: auth.tenantId,
      shipmentId: dto.shipmentId ?? null,
      docType: dto.docType,
      fileName: file.originalname,
      fileBytes: file.buffer,
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
  }

  @Get("review-queue")
  async reviewQueue(@CurrentAuth() auth: AuthContext) {
    return this.documents.reviewQueue(auth.tenantId);
  }

  @Get(":id")
  async get(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.documents.get(id, auth.tenantId);
  }

  @Post(":id/review")
  async review(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ) {
    const dto = ReviewDto.parse(body);
    return this.documents.review({
      documentId: id,
      tenantId: auth.tenantId,
      ...dto,
      actor: { kind: "USER", id: auth.userId, tenantId: auth.tenantId },
    });
  }
}
