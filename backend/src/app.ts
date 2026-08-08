import { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";

import env from "./env";
import db from "./db/db";
import auth from "./auth";

const app: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(env);
  fastify.register(cors, {
    origin: fastify.config.FRONTEND_URL,
    credentials: true,
  });
  fastify.register(cookie);
  fastify.register(sensible);
  fastify.register(db);
  fastify.register(auth);

  fastify.get("/health", async () => ({ status: "ok" }));
};

export default app;
