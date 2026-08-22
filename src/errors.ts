export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

export class BoundError extends Error {
  readonly kind: "depth" | "concurrency" | "respawn";

  constructor(kind: "depth" | "concurrency" | "respawn", message: string) {
    super(message);
    this.name = "BoundError";
    this.kind = kind;
  }
}

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}
