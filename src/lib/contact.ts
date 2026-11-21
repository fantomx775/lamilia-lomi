import { z } from "zod";

import { routing } from "@/i18n/routing";

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(10).max(3_000),
  locale: z.enum(routing.locales).default(routing.defaultLocale),
});

export type ContactInput = z.input<typeof contactSchema>;

export function validateContactInput(input: ContactInput) {
  return contactSchema.safeParse(input);
}

export function buildContactEmail(input: z.output<typeof contactSchema>) {
  return {
    subject: `LamiliaLomi contact from ${input.name}`,
    text: [
      `Name: ${input.name}`,
      `Email: ${input.email}`,
      `Locale: ${input.locale}`,
      "",
      input.message,
    ].join("\n"),
  };
}
