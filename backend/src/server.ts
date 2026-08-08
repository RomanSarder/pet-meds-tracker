import Fastify from "fastify";
import { config } from "dotenv";
import app from "./app";

config();

const isProd = process.env.NODE_ENV === "production";

const server = Fastify({
  logger: isProd
    ? true
    : { transport: { target: "pino-pretty", options: { colorize: true } } },
});

server.register(app);

server.listen(
  { port: Number(process.env.PORT) || 3000, host: "0.0.0.0" },
  (err) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
  },
);

const shutdown = async (signal: string) => {
  server.log.info(`Received ${signal}, shutting down`);
  await server.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
