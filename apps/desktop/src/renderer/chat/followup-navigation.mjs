/**
 * @template {{id:string}} Room
 * @param {Room[]} rooms
 * @param {{roomId:string,messageId:string|null}} source
 * @returns {{room:Room|null,messageId:string|null}}
 */
export function resolveFollowupNavigationTarget(rooms, source) {
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
