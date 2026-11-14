type TimelineTurn = {
  items: Array<{ kind: string; message?: { role?: string } }>;
};

export function visibleTimelineTurn<T extends TimelineTurn>(turn: T): T {
  return {
    ...turn,
    items: turn.items.filter(
      (item) => item.kind === 'message' && item.message?.role !== 'system',
    ),
  };
}

export function visibleTimelineTurns<T extends TimelineTurn>(turns: T[]): T[] {
  return turns.map(visibleTimelineTurn).filter((turn) => turn.items.length > 0);
}
