import { z } from "zod";

export type DeliveryResult = {
  status: "accepted" | "delivered" | "failed" | "unknown" | "simulated";
  code?: string;
  retryable?: boolean;
  providerId?: string;
};
export interface NotificationProvider {
  send(input: {
    to: string;
    message: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<DeliveryResult>;
}
const resultSchema = z.object({
  status: z.enum(["accepted", "delivered", "failed", "unknown", "simulated"]),
  code: z
    .string()
    .regex(/^[A-Z_]{1,60}$/)
    .optional(),
  retryable: z.boolean().optional(),
  providerId: z.string().max(200).optional(),
});
export function selectProvider(
  env: { NODE_ENV?: string; NOTIFICATION_PROVIDER?: string } = process.env,
): NotificationProvider {
  if (
    env.NODE_ENV !== "production" &&
    env.NOTIFICATION_PROVIDER === "simulation"
  ) {
    return {
      async send() {
        return {
          status: "simulated",
          code: "LOCAL_SIMULATION",
          retryable: false,
        };
      },
    };
  }
  return {
    async send() {
      return {
        status: "failed",
        code: "PROVIDER_NOT_CONFIGURED",
        retryable: false,
      };
    },
  };
}
export async function sendBounded(
  provider: NotificationProvider,
  input: Omit<Parameters<NotificationProvider["send"]>[0], "signal">,
  timeoutMs = 5000,
): Promise<DeliveryResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() =>
        provider.send({ ...input, signal: controller.signal }),
      ),
      new Promise<DeliveryResult>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve({
            status: "unknown",
            code: "PROVIDER_TIMEOUT",
            retryable: false,
          });
        }, timeoutMs);
      }),
    ]);
    const parsed = resultSchema.safeParse(result);
    return parsed.success
      ? parsed.data
      : {
          status: "unknown",
          code: "INVALID_PROVIDER_RESPONSE",
          retryable: false,
        };
  } catch {
    return { status: "unknown", code: "PROVIDER_UNCERTAIN", retryable: false };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
