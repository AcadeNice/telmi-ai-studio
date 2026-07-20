export type NarrativeProgress = {
  status: "idle" | "running" | "completed" | "failed";
  percent: number;
  lines: Array<{ at: string; message: string }>;
  startedAt?: string;
  updatedAt?: string;
};

const globalProgress = globalThis as typeof globalThis & {
  telmiNarrativeProgress?: Map<string, NarrativeProgress>;
};

function store() {
  return (globalProgress.telmiNarrativeProgress ??= new Map());
}

export function startNarrativeProgress(versionId: string) {
  const now = new Date().toISOString();
  const progress: NarrativeProgress = {
    status: "running",
    percent: 3,
    startedAt: now,
    updatedAt: now,
    lines: [{ at: now, message: "Demande de génération reçue." }],
  };
  store().set(versionId, progress);
  return progress;
}

export function updateNarrativeProgress(
  versionId: string,
  percent: number,
  message: string,
) {
  const current = store().get(versionId) ?? startNarrativeProgress(versionId);
  const now = new Date().toISOString();
  const next: NarrativeProgress = {
    ...current,
    status: "running",
    percent: Math.max(current.percent, Math.min(99, Math.round(percent))),
    updatedAt: now,
    lines: [...current.lines, { at: now, message }].slice(-30),
  };
  store().set(versionId, next);
  return next;
}

export function finishNarrativeProgress(versionId: string, message: string) {
  const current = store().get(versionId) ?? startNarrativeProgress(versionId);
  const now = new Date().toISOString();
  const next: NarrativeProgress = {
    ...current,
    status: "completed",
    percent: 100,
    updatedAt: now,
    lines: [...current.lines, { at: now, message }].slice(-30),
  };
  store().set(versionId, next);
  return next;
}

export function failNarrativeProgress(versionId: string) {
  const current = store().get(versionId) ?? startNarrativeProgress(versionId);
  const now = new Date().toISOString();
  const next: NarrativeProgress = {
    ...current,
    status: "failed",
    updatedAt: now,
    lines: [
      ...current.lines,
      {
        at: now,
        message:
          "La génération s’est interrompue. Consultez l’erreur affichée.",
      },
    ].slice(-30),
  };
  store().set(versionId, next);
  return next;
}

export function getNarrativeProgress(versionId: string): NarrativeProgress {
  return (
    store().get(versionId) ?? {
      status: "idle",
      percent: 0,
      lines: [],
    }
  );
}
