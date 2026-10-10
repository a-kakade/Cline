import { AppError } from "./http";

type Kind = "number" | "bool" | "list" | "string";
/** Typed query-string parsing; unknown keys are kept as strings so strict schemas reject them. */
export function queryObject(request: Request, spec: Record<string, Kind>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    const kind = spec[key] ?? "string";
    if (kind === "number") {
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n))
        throw new AppError(400, "INVALID_INPUT", `${key} must be a number.`);
      out[key] = n;
    } else if (kind === "bool") out[key] = value === "1" || value === "true";
    else if (kind === "list") out[key] = value.split(",").filter(Boolean);
    else out[key] = value;
  }
  return out;
}
