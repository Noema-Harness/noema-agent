/** Shared hard limits for Noema-owned project execution and safe recovery. */
export const MAX_SOCIAL_WORK_TOOL_CALLS = 24;

// A model needs a response after its final tool result to inspect and report it.
export const MAX_SOCIAL_WORK_TOOL_ROUNDS = MAX_SOCIAL_WORK_TOOL_CALLS + 1;
