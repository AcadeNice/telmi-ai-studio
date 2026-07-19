import type { NarrativeStory } from "./schema";

export type ScenePosition = { x: number; y: number };

const HORIZONTAL_SPACING = 360;
const VERTICAL_SPACING = 230;
const CANVAS_PADDING = 80;

export function buildVerticalGraphLayout(
  narrative: NarrativeStory,
): Record<string, ScenePosition> {
  const sceneIds = new Set(narrative.scenes.map((scene) => scene.id));
  const outgoing = new Map<string, string[]>();

  for (const choice of [...narrative.choices].sort(
    (left, right) => left.order - right.order,
  )) {
    if (
      !sceneIds.has(choice.sourceSceneId) ||
      !sceneIds.has(choice.targetSceneId)
    )
      continue;
    const targets = outgoing.get(choice.sourceSceneId) ?? [];
    if (!targets.includes(choice.targetSceneId))
      targets.push(choice.targetSceneId);
    outgoing.set(choice.sourceSceneId, targets);
  }

  const depths = new Map<string, number>([[narrative.startSceneId, 0]]);
  const queue = [narrative.startSceneId];
  const visited = new Set<string>();

  while (queue.length) {
    const sourceId = queue.shift()!;
    if (visited.has(sourceId)) continue;
    visited.add(sourceId);
    const sourceDepth = depths.get(sourceId) ?? 0;

    for (const targetId of outgoing.get(sourceId) ?? []) {
      const nextDepth = sourceDepth + 1;
      if (!depths.has(targetId)) {
        depths.set(targetId, nextDepth);
        queue.push(targetId);
      }
    }
  }

  const deepest = Math.max(0, ...depths.values());
  for (const scene of narrative.scenes) {
    if (!depths.has(scene.id)) depths.set(scene.id, deepest + 1);
  }

  const rows = new Map<number, string[]>();
  for (const scene of narrative.scenes) {
    const depth = depths.get(scene.id) ?? 0;
    rows.set(depth, [...(rows.get(depth) ?? []), scene.id]);
  }

  const widestRow = Math.max(1, ...[...rows.values()].map((row) => row.length));
  const widestRowWidth = (widestRow - 1) * HORIZONTAL_SPACING;
  const positions: Record<string, ScenePosition> = {};

  for (const [depth, row] of [...rows.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    const rowWidth = (row.length - 1) * HORIZONTAL_SPACING;
    const rowStart = CANVAS_PADDING + (widestRowWidth - rowWidth) / 2;
    row.forEach((sceneId, index) => {
      positions[sceneId] = {
        x: rowStart + index * HORIZONTAL_SPACING,
        y: CANVAS_PADDING + depth * VERTICAL_SPACING,
      };
    });
  }

  return positions;
}
