import { SessionUser } from "@pet-tracker/shared";
import { magicLinkTokens, sessions, users } from "../db/schema";
import { generateSecureRandomString, hashSecret } from "./utils";
import { addToDate } from "../utils";
import { eq } from "drizzle-orm";
import authenticatePlugin from "./authenticate-plugin";
import fastifyPlugin from "fastify-plugin";
import { sendMagicLinkEmail } from "../email";

export default fastifyPlugin(async (fastify) => {
  fastify.register(authenticatePlugin);

  fastify.register(
    (fastify) => {
      fastify.post<{ Body: { email: string } }>(
        "/sign-in",
        {
          schema: {
            body: {
              type: "object",
              required: ["email"],
              properties: {
                email: { type: "string", format: "email" },
              },
            },
          },
        },
        async (request) => {
          const { email } = request.body;

          const [inserted] = await fastify.db
            .insert(users)
            .values({ email })
            .onConflictDoNothing()
            .returning();

          const user = inserted ?? (await fastify.db.select().from(users).where(eq(users.email, email)))[0];

          if (!user) {
            throw fastify.httpErrors.internalServerError();
          }

          const magicLinkToken = generateSecureRandomString();

          const [magicLink] = await fastify.db
            .insert(magicLinkTokens)
            .values({
              token: magicLinkToken,
              userId: user.id,
              expiresAt: addToDate(new Date(), { minutes: 15 }),
            })
            .returning();

          await sendMagicLinkEmail(email, magicLink.token);
        },
      );

      fastify.post<{ Querystring: { token: string } }>(
        "/token/verify",
        {
          schema: {
            querystring: {
              type: "object",
              required: ["token"],
              properties: {
                token: {
                  type: "string",
                },
              },
            },
          },
        },
        async (request, reply) => {
          const { token } = request.query;

          // Atomic delete-and-return: exactly one concurrent request can consume a given
          // token row, so this is what enforces the single-use invariant. Do not "simplify"
          // this back into a select followed by a later delete.
          const [magicLink] = await fastify.db
            .delete(magicLinkTokens)
            .where(eq(magicLinkTokens.token, token))
            .returning();

          if (!magicLink || magicLink.expiresAt < new Date()) {
            return reply.unauthorized("Invalid credentials");
          }

          const id = generateSecureRandomString();
          const secret = generateSecureRandomString();
          const secretHash = await hashSecret(secret);

          const cookieToken = id + "." + secret;

          await fastify.db.insert(sessions).values({
            id,
            userId: magicLink.userId,
            secretHash: Buffer.from(secretHash).toString("hex"),
            expiresAt: addToDate(new Date(), { days: 7 }),
          });

          const isProd = fastify.config.NODE_ENV === "production";
          reply.setCookie("pet_tracker_token", cookieToken, {
            path: "/",
            httpOnly: true,
            secure: isProd,
            sameSite: isProd ? "none" : "lax",
            maxAge: 60 * 60 * 24 * 7, // 7 days
          });
        },
      );

      fastify.get("/me", { preHandler: fastify.authenticate }, async (request): Promise<SessionUser> => {
        const [user] = await fastify.db.select().from(users).where(eq(users.id, request.userId));

        if (!user) {
          throw fastify.httpErrors.unauthorized();
        }

        return { id: user.id, email: user.email };
      });

      fastify.post("/sign-out", { preHandler: fastify.authenticate }, async (request, reply) => {
        const cookie = request.cookies["pet_tracker_token"];
        const [id] = (cookie ?? "").split(".");

        if (id) {
          await fastify.db.delete(sessions).where(eq(sessions.id, id));
        }

        reply.clearCookie("pet_tracker_token", { path: "/" });

        return {};
      });
    },
    { prefix: "/auth" },
  );
});
