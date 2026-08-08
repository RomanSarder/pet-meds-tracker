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
  fastify.decorateRequest("userId", "");

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
