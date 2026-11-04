import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { startQueue, stopQueue } from "./jobs/queue.js";

await startQueue();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
  console.log(env.SMTP_HOST ? `Emails go to SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}` : "Emails are logged to the console (SMTP_HOST is empty)");
});

const shutdown = async () => {
  server.close();
  await stopQueue();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
