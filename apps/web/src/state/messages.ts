import type { ChatMessage } from '@focusspace/shared';
export function mergeMessages(
  old: ChatMessage[],
  incoming: ChatMessage[],
  at: number,
): ChatMessage[] {
  const messages = new Map(
    old
      .concat(incoming)
      .filter((m) => m.createdAt >= at - 86400000)
      .map((m) => [m.id, m]),
  );
  return [...messages.values()]
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(-50);
}
