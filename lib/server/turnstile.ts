import { cookies } from "next/headers";

const turnstileCookieName = "im_turnstile";
const turnstileVerifiedMs = 30 * 60 * 1000;

export async function verifyTurnstile(token?: string | null): Promise<boolean> {
  if (process.env.TURNSTILE_REQUIRED !== "true") return true;
  const jar = await cookies();
  const verifiedAt = Number(jar.get(turnstileCookieName)?.value ?? 0);
  if (Number.isFinite(verifiedAt) && Date.now() - verifiedAt < turnstileVerifiedMs) return true;
  if (!process.env.TURNSTILE_SECRET_KEY || !token) return false;

  const form = new FormData();
  form.append("secret", process.env.TURNSTILE_SECRET_KEY);
  form.append("response", token);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  const data = (await response.json()) as { success?: boolean };
  if (data.success !== true) return false;

  jar.set(turnstileCookieName, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: turnstileVerifiedMs / 1000
  });
  return true;
}
