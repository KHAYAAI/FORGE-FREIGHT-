import { Global, Module } from "@nestjs/common";
import { createDb, type Db } from "@forge-freight/db";

export const DB = Symbol("DB");

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => createDb(),
    },
  ],
  exports: [DB],
})
export class DbModule {}
