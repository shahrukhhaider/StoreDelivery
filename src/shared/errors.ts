/**
 * Application error types.
 */

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export class MappingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "MappingError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "ImportError";
  }
}
