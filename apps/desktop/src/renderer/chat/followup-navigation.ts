export function resolveFollowupNavigationTarget<Room extends { id: string }>(
  rooms: Room[],
  source: { roomId: string; messageId: string | null },
): { room: Room | null; messageId: string | null } {
  const sourceRoom = rooms.find((room) => room.id === source.roomId) ?? null;
  const room =
    sourceRoom ??
    rooms.find((candidate) => candidate.id === 'room-noema') ??
    null;
  return {
    room,
    messageId: sourceRoom ? source.messageId : null,
  };
}
