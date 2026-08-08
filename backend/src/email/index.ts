import { Resend } from "resend";

function buildMagicLinkHtml(verifyUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign in to pet-tracker</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#0a0a0a;padding:24px 40px;border-radius:8px 8px 0 0;">
              <span style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:0.18em;color:#71717a;text-transform:uppercase;font-weight:400;">pet-tracker</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;border-left:1px solid #e4e4e7;border-right:1px solid #e4e4e7;">
              <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:600;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Sign in to pet-tracker</h1>
              <p style="margin:0 0 32px 0;font-size:14px;color:#71717a;line-height:1.6;">
                Click the button below to sign in. This link expires in&nbsp;<strong style="color:#18181b;">15&nbsp;minutes</strong>.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#18181b;border-radius:6px;">
                    <a href="${verifyUrl}" style="display:inline-block;padding:11px 24px;font-size:14px;font-weight:500;color:#fafafa;text-decoration:none;letter-spacing:-0.01em;">Continue &rarr;</a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin:0 0 24px 0;font-size:12px;color:#71717a;line-height:1.6;">
                If the button doesn't work, copy and paste this URL into your browser:<br />
                <a href="${verifyUrl}" style="color:#71717a;word-break:break-all;">${verifyUrl}</a>
              </p>

              <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 24px 0;" />

              <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.6;">
                If you didn't request this sign-in link, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f4f4f5;padding:20px 40px;border-radius:0 0 8px 8px;border:1px solid #e4e4e7;border-top:none;">
              <span style="font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:0.18em;color:#a1a1aa;text-transform:uppercase;">pet-tracker</span>
              <span style="font-size:11px;color:#a1a1aa;margin-left:8px;">&middot; link expires in 15 minutes</span>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  let frontendUrl = process.env.FRONTEND_PUBLIC_URL ?? "http://localhost:5173";
  if (process.env.NODE_ENV === "production") {
    frontendUrl = frontendUrl.replace(/^http:\/\//, "https://");
  }
  const verifyUrl = `${frontendUrl}/auth/verify?token=${token}`;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[magic-link] ${verifyUrl}`);
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: email,
    subject: "Sign in to pet-tracker",
    html: buildMagicLinkHtml(verifyUrl),
  });

  if (error) {
    throw new Error(`Failed to send magic link email: ${error.message}`);
  }
}
