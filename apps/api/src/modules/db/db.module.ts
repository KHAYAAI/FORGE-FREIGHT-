import { Global, Module } from "@nestjs/common";
import { createDb, type Db } from "@forge-freight/db";
import { CONFIG, type AppConfig } from "../../config.js";

export const DB = Symbol("DB");

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig): Db => createDb(cfg.DATABASE_URL),
    },
  ],
  exports: [DB],
})
export class DbModule {}
