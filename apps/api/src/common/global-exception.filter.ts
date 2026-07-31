import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/**
 * The API's single global exception filter.
 *
 * A separate `@Catch(ZodError)` filter used to be registered ahead of this one
 * on the assumption that listing the specific filter first would give it
 * priority. It does not — Nest evaluates global filters in reverse
 * registration order, so this catch-all, registered last, swallowed every
 * validation error and answered `500 Internal server error`. Malformed
 * requests had been reported as the server's fault, with the field-level
 * detail never reaching the caller.
 *
 * Handling the specific case here rather than reordering means there is no
 * ordering left to get wrong.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("UnhandledException");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    // Malformed input is the client's fault: 400, naming the offending fields.
    if (exception instanceof ZodError) {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: "Bad Request",
        issues: exception.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === "string" ? { statusCode: status, message: body } : body);
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack ?? exception.message : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    });
  }
}
