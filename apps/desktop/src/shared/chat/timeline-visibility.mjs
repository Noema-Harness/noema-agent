/**
 * @template {{ items: Array<{ kind: string, message?: { role?: string } }> }} T
 * @param {T} turn
 * @returns {T}
 */
export function visibleTimelineTurn(turn) {
  return {
    ...turn,
    items: turn.items.filter(
      (item) => item.kind === 'message' && item.message?.role !== 'system',
    ),
  };
}

/**
 * @template {{ items: Array<{ kind: string, message?: { role?: string } }> }} T
 * @param {T[]} turns
 * @returns {T[]}
 */
export function visibleTimelineTurns(turns) {
  return turns.map(visibleTimelineTurn).filter((turn) => turn.items.length > 0);
}
