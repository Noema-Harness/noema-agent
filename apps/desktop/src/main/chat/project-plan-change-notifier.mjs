export class ProjectPlanChangeNotifier {
  constructor({ collaboration, scheduleInboxes }) {
    this.collaboration = collaboration;
    this.scheduleInboxes = scheduleInboxes;
  }

  notify(projectId, run = null) {
    this.collaboration?.planChanged(projectId, {
      rootId: run?.rootId ?? run?.turnId ?? null,
      depth: (run?.depth ?? 0) + 1,
    });
    this.scheduleInboxes();
  }
}
