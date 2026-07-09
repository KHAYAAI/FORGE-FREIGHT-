import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";

export const TASK_QUEUE = "shipment-lifecycle";

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./workflows/shipment-lifecycle.js", import.meta.url)),
    activities,
  });
  console.log(`Shipment lifecycle worker polling ${address} (queue=${TASK_QUEUE})`);
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
