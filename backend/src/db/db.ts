import fp from "fastify-plugin";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

declare module "fastify" {
  interface FastifyInstance {
    db: PostgresJsDatabase<typeof schema>;
  }
}

export default fp(async (fastify) => {
  const db = drizzle({
    schema,
    connection: {
      url: fastify.config.DATABASE_URL,
    },
  });

  fastify.decorate("db", db);
});
