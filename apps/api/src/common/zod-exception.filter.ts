import { ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/** Malformed input is the client's fault: 400 with field-level issues, not a 500. */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(400).json({
      statusCode: 400,
      error: "Bad Request",
      issues: exception.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
}
