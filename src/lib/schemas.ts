import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export const contactSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a contact name.")
      .max(80, "Name must be at most 80 characters."),
    phone_number: z
      .string()
      .max(40)
      .transform((value, ctx) => {
        const phone = parsePhoneNumberFromString(value, {
          defaultCountry: "IN",
          extract: false,
        });
        if (!phone?.isValid()) {
          ctx.addIssue({
            code: "custom",
            message:
              "Enter a valid phone number, including country code outside India.",
          });
          return z.NEVER;
        }
        return phone.number;
      }),
    relationship: z.string().trim().max(60).optional(),
    alert_enabled: z.boolean().default(false),
  })
  .strict();
export type Contact = {
  id: string;
  user_id: string;
  name: string;
  phone_number: string;
  relationship: string | null;
  alert_enabled: boolean;
  created_at: number;
  updated_at: number;
};
