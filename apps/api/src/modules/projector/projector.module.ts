import { Module } from "@nestjs/common";
import { TemporalService } from "../temporal/temporal.service.js";
import { BillingAccrual } from "./billing-accrual.js";
import {
  EVENT_HANDLERS,
  EventDispatcherService,
} from "./event-dispatcher.service.js";
import { LedgerSink } from "./ledger-sink.js";
import { LifecycleProjector } from "./lifecycle-projector.js";
import { WorkflowSignaler } from "./workflow-signaler.js";

@Module({
  providers: [
    {
      provide: EVENT_HANDLERS,
      inject: [TemporalService],
      useFactory: (temporal: TemporalService) => [
        new LifecycleProjector(),
        new BillingAccrual(),
        new LedgerSink(),
        new WorkflowSignaler(temporal),
      ],
    },
    EventDispatcherService,
  ],
  exports: [EventDispatcherService],
})
export class ProjectorModule {}
