export class TcisError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class ContractError extends TcisError {}
export class StateError extends TcisError {}
export class TransitionError extends TcisError {}
export class ConcurrencyError extends TcisError {}
export class NotFoundError extends TcisError {}
