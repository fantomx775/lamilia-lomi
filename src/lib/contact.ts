import { z } from "zod";

export const contactSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  message: z.string().min(10).max(3_000),
  locale: z.enum(["en", "pl"]).default("en"),
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
