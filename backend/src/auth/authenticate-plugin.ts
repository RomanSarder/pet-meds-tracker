import fp from "fastify-plugin";
import { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { sessions } from "../db/schema";
import { hashSecret } from "./utils";
import { addToDate } from "../utils";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

export default fp(async (fastify) => {
  // This plugin is registered from three independent feature plugins
  // (auth/index.ts, household/index.ts, sync/index.ts), each of which
  // genuinely depends on `fastify.authenticate` and declares that dependency
  // by registering it directly. Since it's wrapped in fastify-plugin,
  // encapsulation is off and the decoration is global — so without this
  // guard, the second and third registrations would throw
  // FST_ERR_DEC_ALREADY_PRESENT. Guarding on Fastify's own decorator check
  // makes registering this plugin any number of times harmless.
  if (!fastify.hasRequestDecorator("userId")) {
    fastify.decorateRequest("userId", "");
  }

  if (fastify.hasDecorator("authenticate")) {
    return;
  }

  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const cookie = request.cookies["pet_tracker_token"];

    if (!cookie) {
      return reply.unauthorized();
    }

    const [id, secret] = cookie.split(".");

    if (!id || !secret) {
      return reply.unauthorized();
    }

    const [session] = await fastify.db.select().from(sessions).where(eq(sessions.id, id));

    if (!session) {
      return reply.unauthorized();
    }

    const secretHash = Buffer.from(await hashSecret(secret)).toString("hex");
    const storedHash = session.secretHash ?? "";
    const secretHashBuffer = Buffer.from(secretHash, "hex");
    const storedHashBuffer = Buffer.from(storedHash, "hex");

    if (
      secretHashBuffer.length !== storedHashBuffer.length ||
      !timingSafeEqual(secretHashBuffer, storedHashBuffer)
    ) {
      return reply.unauthorized();
    }

    if (session.expiresAt < new Date()) {
      return reply.unauthorized();
    }

    request.userId = session.userId;

    await fastify.db
      .update(sessions)
      .set({ expiresAt: addToDate(new Date(), { days: 7 }) })
      .where(eq(sessions.id, id));
  });
});
