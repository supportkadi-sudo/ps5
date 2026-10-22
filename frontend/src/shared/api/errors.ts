/** A validated, definite rejection with no committed operation. Unknown errors retain pending. */
export class CommandRejected extends Error {}

/** Outcome needs reconciliation; retaining the original key is mandatory. */
export class CommandConflict extends Error {}
