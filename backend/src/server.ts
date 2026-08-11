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

// Bind "::" (all interfaces, IPv6 + IPv4-mapped), not "0.0.0.0". Railway's
// private network is IPv6-only: `<service>.railway.internal` publishes AAAA
// records exclusively, so an IPv4-only bind accepts nothing from a sibling
// service and every private-network connect hangs until the caller's timeout.
server.listen(
  { port: Number(process.env.PORT) || 3000, host: "::" },
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
