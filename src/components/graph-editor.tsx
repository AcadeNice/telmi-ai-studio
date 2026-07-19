"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import { GitBranch, Save } from "lucide-react";
import {
  buildVerticalGraphLayout,
  type ScenePosition,
} from "@/lib/narrative/layout";
import type { NarrativeStory } from "@/lib/narrative/schema";

type LayoutPosition = { id: string; position: ScenePosition };

function buildNodes(
  narrative: NarrativeStory,
  useSavedLayout: boolean,
  forceVertical = false,
): Node[] {
  const automaticPositions = buildVerticalGraphLayout(narrative);
  const useSavedPositions = !forceVertical && useSavedLayout;

  return narrative.scenes.map((scene) => ({
    id: scene.id,
    position:
      useSavedPositions && scene.position
        ? scene.position
        : automaticPositions[scene.id]!,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {
      label: (
        <div>
          <strong>{scene.title}</strong>
          <small>{scene.type}</small>
        </div>
      ),
    },
    className: `flow-node flow-${scene.type}`,
  }));
}

export function GraphEditor({
  narrative,
  savedLayout,
  onSceneSelect,
  onSaveLayout,
}: {
  narrative: NarrativeStory;
  savedLayout: boolean;
  onSceneSelect?: (sceneId: string) => void;
  onSaveLayout?: (positions: LayoutPosition[]) => Promise<void>;
}) {
  const initialNodes = useMemo(
    () => buildNodes(narrative, savedLayout),
    [narrative, savedLayout],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [flow, setFlow] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const edges: Edge[] = useMemo(
    () =>
      narrative.choices.map((choice) => ({
        id: choice.id,
        source: choice.sourceSceneId,
        target: choice.targetSceneId,
        label: choice.label,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: true,
      })),
    [narrative.choices],
  );

  useEffect(() => {
    queueMicrotask(() => {
      setNodes(buildNodes(narrative, savedLayout));
      setDirty(false);
    });
  }, [narrative, savedLayout, setNodes]);

  const fitGraph = useCallback(() => {
    requestAnimationFrame(
      () => void flow?.fitView({ padding: 0.18, duration: 350 }),
    );
  }, [flow]);

  const reorganize = useCallback(() => {
    setNodes(buildNodes(narrative, savedLayout, true));
    setDirty(true);
    fitGraph();
  }, [fitGraph, narrative, savedLayout, setNodes]);

  const saveLayout = useCallback(async () => {
    if (!onSaveLayout || saving) return;
    setSaving(true);
    try {
      await onSaveLayout(
        nodes.map((node) => ({ id: node.id, position: node.position })),
      );
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [nodes, onSaveLayout, saving]);

  return (
    <div className="graph-editor">
      <div className="graph-toolbar">
        <div>
          <strong>Disposition verticale</strong>
          <small>Glissez chaque bulle, puis enregistrez sa position.</small>
        </div>
        <div className="inline-actions">
          <button
            className="secondary compact"
            type="button"
            onClick={reorganize}
          >
            <GitBranch /> Réorganiser
          </button>
          <button
            className="primary compact"
            type="button"
            disabled={!dirty || saving || !onSaveLayout}
            onClick={() => void saveLayout()}
          >
            <Save /> {saving ? "Enregistrement…" : "Enregistrer la disposition"}
          </button>
        </div>
      </div>
      <div className="graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          nodesDraggable
          nodesConnectable={false}
          onInit={setFlow}
          onNodesChange={onNodesChange}
          onNodeDragStop={() => setDirty(true)}
          onNodeClick={(_, node) => onSceneSelect?.(node.id)}
        >
          <MiniMap />
          <Controls />
          <Background gap={24} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}
