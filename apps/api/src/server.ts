import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { processDueTasks } from "./worker.js";

const server = app.listen(config.port, () => {
  console.info(`SafeStride API listening on port ${config.port}`);
});

const worker = setInterval(() => {
  void processDueTasks().catch((error: unknown) => console.error("Background task processing failed:", error instanceof Error ? error.name : "UnknownError"));
}, 5000);
worker.unref();

async function shutdown() {
  clearInterval(worker);
  server.close();
  await prisma.$disconnect();
}
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
