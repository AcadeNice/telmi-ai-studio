"use client";

import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { NarrativeStory } from "@/lib/narrative/schema";

export function GraphEditor({ narrative }: { narrative: NarrativeStory }) {
  const nodes: Node[] = narrative.scenes.map((scene, index) => ({
    id: scene.id,
    position: scene.position ?? {
      x: (index % 4) * 250,
      y: Math.floor(index / 4) * 180,
    },
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
  const edges: Edge[] = narrative.choices.map((choice) => ({
    id: choice.id,
    source: choice.sourceSceneId,
    target: choice.targetSceneId,
    label: choice.label,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: true,
  }));
  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <MiniMap />
        <Controls />
        <Background gap={18} size={1} />
      </ReactFlow>
    </div>
  );
}
