import { createWindowProbes } from './window-probes';
import { createAgentProbes } from './agent-probes';
import { createAttachmentProbes } from './attachment-probes';
import { createFirstUseProbes } from './first-use-probes';
import type { DesktopProbeContext } from './probe-context';
export function createDesktopProbes(context: DesktopProbeContext) {
  const attachments = createAttachmentProbes(context);
  return {
    ...createWindowProbes(context),
    ...attachments,
    ...createFirstUseProbes(context),
    ...createAgentProbes(context, attachments),
  };
}

export type DesktopProbes = ReturnType<typeof createDesktopProbes>;
export type DesktopProbeRunner = <K extends keyof DesktopProbes>(
  name: K,
  ...args: Parameters<DesktopProbes[K]>
) => Promise<Awaited<ReturnType<DesktopProbes[K]>>>;
