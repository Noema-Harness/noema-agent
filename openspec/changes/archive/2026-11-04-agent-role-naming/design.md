# Design

## Decision

Treat an execution agent as a durable function, not a simulated person. For model-created specialists and project-team members, make the requested `name` a short label derived from their continuing responsibility (for example, `代码审阅员` or `数据分析师`). The name should fit the `headline` and `description`, not the one-off task.

Do not invent a realistic personal name, surname, biography, or human identity. Permit a personal name only when the user's request explicitly asks for a named persona or real-name-style label. A user who manually creates or renames an agent keeps control of the value they entered.

## Enforcement location

Add the rule to both model-facing agent creation schemas: `delegate_to_specialist.new_agent` and `create_project_team.members[].new_agent`. Also add one concise high-level rule to `noemaActionGuidance` for agent creation. This reaches both the field-generation step and Noema's tool selection/coordination context without duplicating a long policy block.

Do not add a heuristic real-name detector or silently rewrite model output in storage. Names can be multilingual, and names like `林业研究员` can contain characters also used in personal names; a blocklist would reject valid role labels and cannot reliably detect a requested persona. Keep deterministic persistence validation focused on shape and length. Verify the behavior contract by asserting both schema descriptions and the shared action guidance contain the rule.

## Compatibility

No schema or database migration is needed. Existing saved agents, user-entered names, IDs, room history, project membership, and references remain unchanged. This only guides newly generated names.

## Failure behavior

If the model returns a role name inconsistent with its own role description, the result remains subject to the existing user-visible profile and project creation review flow; do not invent or silently substitute another name in storage. Future user feedback can determine whether a structured user-requested-name field is necessary.
