export async function verifyTurnstile(token?: string | null): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && !process.env.TURNSTILE_SECRET_KEY) return true;
  if (!process.env.TURNSTILE_SECRET_KEY || !token) return false;

  const form = new FormData();
  form.append("secret", process.env.TURNSTILE_SECRET_KEY);
  form.append("response", token);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
}
