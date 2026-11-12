/**
 * Runtime profiles are the product-level contract for who may do what.
 *
 * A profile is not a model, provider, room, project, or card. It is the
 * permission/tool/context envelope attached to one agent session. Keeping the
 * envelope in one place prevents a chat route, project route, or team route
 * from quietly granting a stronger role than the product intended.
 */

export const AGENT_PROFILE_IDS = Object.freeze([
  'noema',
  'specialist',
  'executor',
  'group-lead',
]);

const PROFILES = Object.freeze({
  noema: Object.freeze({
    id: 'noema',
    label: 'Noema',
    visible: true,
    hiddenFromContacts: false,
    canUseSocial: true,
    canUseProjects: true,
    canCreateCards: true,
    canExecuteCards: false,
    canUseFilesystem: false,
    canUseShell: false,
    canUseWebSearch: true,
    memoryScopes: Object.freeze(['personal', 'project']),
  }),
  specialist: Object.freeze({
    id: 'specialist',
    label: 'Specialist',
    visible: true,
    hiddenFromContacts: false,
    canUseSocial: true,
    canUseProjects: true,
    canCreateCards: false,
    canExecuteCards: false,
    canUseFilesystem: false,
    canUseShell: false,
    canUseWebSearch: true,
    memoryScopes: Object.freeze(['specialist', 'project']),
  }),
  executor: Object.freeze({
    id: 'executor',
    label: 'Executor',
    visible: false,
    hiddenFromContacts: true,
    canUseSocial: false,
    canUseProjects: false,
    canCreateCards: false,
    canExecuteCards: true,
    canUseFilesystem: true,
    canUseShell: true,
    canUseWebSearch: false,
    memoryScopes: Object.freeze([]),
  }),
  'group-lead': Object.freeze({
    id: 'group-lead',
    label: 'Group lead',
    visible: true,
    hiddenFromContacts: false,
    canUseSocial: true,
    canUseProjects: true,
    canCreateCards: true,
    canExecuteCards: false,
    canUseFilesystem: false,
    canUseShell: false,
    canUseWebSearch: true,
    memoryScopes: Object.freeze(['project']),
  }),
});

export function isAgentProfileId(value) {
  return typeof value === 'string' && Object.hasOwn(PROFILES, value);
}

export function getAgentProfile(profileId) {
  if (!isAgentProfileId(profileId))
    throw new TypeError(`Unknown agent profile: ${String(profileId)}`);
  return PROFILES[profileId];
}

/**
 * Resolve the profile for a product identity. This is intentionally explicit:
 * unknown agents are treated as specialists, never as executors, so a future
 * contact cannot accidentally gain filesystem or shell access.
 */
export function resolveAgentProfile(agentId) {
  if (agentId === 'noema') return PROFILES.noema;
  if (agentId === 'noema-executor') return PROFILES.executor;
  return PROFILES.specialist;
}
