import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { TemporalService } from "../temporal/temporal.service.js";
import { BillingAccrual } from "./billing-accrual.js";
import {
  EVENT_HANDLERS,
  EventDispatcherService,
} from "./event-dispatcher.service.js";
import { LedgerSink } from "./ledger-sink.js";
import { LifecycleProjector } from "./lifecycle-projector.js";
import { NotificationDispatcher } from "./notification-dispatcher.js";
import { WorkflowSignaler } from "./workflow-signaler.js";

@Module({
  imports: [NotificationsModule],
  providers: [
    {
      provide: EVENT_HANDLERS,
      inject: [TemporalService, NotificationsService],
      useFactory: (temporal: TemporalService, notifications: NotificationsService) => [
        new LifecycleProjector(),
        new BillingAccrual(),
        new LedgerSink(),
        new WorkflowSignaler(temporal),
        new NotificationDispatcher(notifications),
      ],
    },
    EventDispatcherService,
  ],
  exports: [EventDispatcherService],
})
export class ProjectorModule {}
