export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "NETWORK",
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok)
        throw new ApiError(
          response.status === 401
            ? "Your session has expired. Sign in again."
            : typeof payload?.error?.message === "string"
              ? payload.error.message
              : "The request could not be completed.",
          response.status,
          payload?.error?.code ?? "UNAVAILABLE",
        );
      if (!payload || !("data" in payload))
        throw new ApiError("The server response could not be confirmed.");
      return payload.data as T;
    });
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new ApiError(
              "The request timed out. Its outcome is not confirmed.",
              0,
              "TIMEOUT",
            ),
          );
        }, 12000);
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "Connection interrupted. The request outcome is not confirmed.",
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
