const URL_WITH_QUERY = /https?:\/\/[^\s?]+\?[^\s]+/giu;

export interface SafeError {
  cause?: SafeError;
  code?: string;
  message: string;
  name: string;
}

const MAX_CAUSE_DEPTH = 3;

function sanitizeMessage(message: string): string {
  return message.replace(URL_WITH_QUERY, "[URL REDACTED]").slice(0, 1_000);
}

export function toSafeError(error: unknown, depth = 0): SafeError {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    // Network failures surface as a generic "fetch failed" TypeError whose
    // actionable detail (ECONNREFUSED, ENETUNREACH, EAI_AGAIN, …) lives on the
    // cause chain; drop it and the persisted error is undiagnosable.
    const cause =
      error.cause !== undefined && error.cause !== null && depth < MAX_CAUSE_DEPTH
        ? toSafeError(error.cause, depth + 1)
        : undefined;
    return {
      ...(cause === undefined ? {} : { cause }),
      ...(code === undefined ? {} : { code }),
      message: sanitizeMessage(error.message || "Unspecified error"),
      name: error.name || "Error",
    };
  }

  return {
    message: "Non-Error value thrown",
    name: "UnknownError",
  };
}
