type PlanChangeRun = {
  rootId?: string | null;
  turnId?: string | null;
  depth?: number;
};

export class ProjectPlanChangeNotifier {
  declare collaboration:
    | {
        planChanged: (
          projectId: string,
          run: { rootId: string | null; depth: number },
        ) => unknown;
      }
    | null
    | undefined;
  declare scheduleInboxes: () => void;

  constructor({
    collaboration,
    scheduleInboxes,
  }: {
    collaboration: ProjectPlanChangeNotifier['collaboration'];
    scheduleInboxes: () => void;
  }) {
    this.collaboration = collaboration;
    this.scheduleInboxes = scheduleInboxes;
  }

  notify(projectId: string, run: PlanChangeRun | null = null) {
    this.collaboration?.planChanged(projectId, {
      rootId: run?.rootId ?? run?.turnId ?? null,
      depth: (run?.depth ?? 0) + 1,
    });
    this.scheduleInboxes();
  }
}
