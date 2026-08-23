export class MeetronError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "MeetronError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function serializeError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR",
    message: error?.message || "Unexpected Meetron error",
    ...(error?.details !== undefined && { details: error.details }),
  };
}
