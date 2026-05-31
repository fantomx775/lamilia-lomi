import { Resend } from "resend";

let resend: Resend | null = null;

export function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return null;
  }

  resend ??= new Resend(apiKey);

  return resend;
}
