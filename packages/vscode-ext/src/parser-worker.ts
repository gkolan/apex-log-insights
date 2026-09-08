import { parentPort } from "node:worker_threads";

import { processWorkerRequest } from "./process-worker-request.js";

if (!parentPort) throw new Error("Parser worker requires a parent port.");
const port = parentPort;

port.on("message", async (request: unknown) => {
  const response = await processWorkerRequest(request);
  if (response) port.postMessage(response);
});
