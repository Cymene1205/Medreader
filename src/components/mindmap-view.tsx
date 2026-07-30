"use client";

import { memo, useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network, Loader2 } from "lucide-react";
import type {
  Outline,
  OutlineChild,
  OutlineSection,
} from "@/components/outline-panel";
import {
  outlineToFlow,
  MINIMAP_DEFAULT_COLOR,
  type FlowNode,
} from "@/lib/outline-to-flow";

type MindmapViewProps = {
  outline: Outline | null;
  onChildClick: (child: OutlineChild, section: OutlineSection) => void;
};

// Pull the data shape from FlowNode so the renderer stays in sync
type DimNodeData = FlowNode["data"];

/**
 * Custom node renderer used for root / section / child nodes.
 * Differentiates the three flavors via `data.isRoot`, `data.isSection`,
 * and the presence of `data.child`.
 */
const DimNode = memo(function DimNode({ data, selected }: NodeProps) {
  const d = data as unknown as DimNodeData;

  // Root node — paper title --------------------------------------------
  if (d.isRoot) {
    const bg = d.dimColor || "#475569";
    return (
      <div
        className="rounded-lg px-3 py-2 text-white text-[13px] font-semibold shadow-sm transition-shadow"
        style={{
          background: bg,
          border: `1px solid ${bg}`,
          width: 220,
          minHeight: 90,
          boxShadow: selected ? `0 0 0 2px ${bg}55` : undefined,
        }}
      >
        <Handle type="source" position={Position.Right} style={hiddenHandle} />
        <div className="line-clamp-2 leading-tight">{d.label}</div>
      </div>
    );
  }

  // Section node — dim badge + title + summary + key points ----------------
  if (d.isSection) {
    const color = d.dimColor || "#2C5F8D";
    return (
      <div
        className="rounded-lg bg-white shadow-sm flex overflow-hidden transition-shadow"
        style={{
          border: `1px solid ${color}`,
          borderLeft: `4px solid ${color}`,
          width: 300,
          minHeight: 220,
          boxShadow: selected ? `0 0 0 2px ${color}44` : undefined,
        }}
      >
        <Handle type="target" position={Position.Left} style={hiddenHandle} />
        <div className="px-2.5 py-2 flex-1 min-w-0">
          <div className="flex items-start gap-1.5">
            <span
              className="flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center mt-0.5 text-white"
              style={{ background: color }}
              aria-hidden
            >
              {(d.index ?? 0) + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">
                {d.label}
              </div>
              {d.summary && (
                <div className="text-[10.5px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                  {d.summary}
                </div>
              )}
              {d.keyPoints && d.keyPoints.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {d.keyPoints.slice(0, 3).map((kp, i) => (
                    <li
                      key={i}
                      className="text-[9.5px] leading-snug flex items-start gap-1"
                      style={{ color: color }}
                    >
                      <span className="opacity-60 flex-shrink-0">•</span>
                      <span className="text-foreground/75 line-clamp-1">{kp}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <Handle type="source" position={Position.Right} style={hiddenHandle} />
      </div>
    );
  }

  // Child node — title + summary with lighter background --------------
  const bg = d.dimColor || "#F1F5F9";
  return (
    <div
      className="rounded-lg px-2.5 py-1.5 shadow-sm transition-shadow"
      style={{
        background: bg,
        border: `1px solid ${bg}`,
        width: 240,
        minHeight: 110,
        boxShadow: selected ? "0 0 0 2px #94A3B855" : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandle} />
      <div className="text-[12px] font-medium leading-snug text-foreground/90 line-clamp-2">
        {d.label}
      </div>
      {d.summary && (
        <div className="text-[10px] text-muted-foreground/80 mt-0.5 line-clamp-2 leading-snug">
          {d.summary}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={hiddenHandle} />
    </div>
  );
});

DimNode.displayName = "DimNode";

const hiddenHandle: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  pointerEvents: "none",
};

// Map the input/default/output built-in types (and the explicit dimNode
// type) to the same custom renderer.
const nodeTypes = {
  input: DimNode,
  default: DimNode,
  output: DimNode,
  dimNode: DimNode,
};

export default function MindmapView({ outline, onChildClick }: MindmapViewProps) {
  // Recompute the dagre layout whenever the outline reference changes
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => outlineToFlow(outline),
    [outline]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(
    layoutedNodes as Node[]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    layoutedEdges as Edge[]
  );

  // Sync internal state when the layouted nodes/edges change
  useEffect(() => {
    setNodes(layoutedNodes as Node[]);
    setEdges(layoutedEdges as Edge[]);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const d = node.data as unknown as DimNodeData;
      // Child node → jump to the quote in the PDF
      if (d.child && d.section) {
        onChildClick(d.child, d.section);
        return;
      }
      // Section node with a quote → jump to the section quote
      if (d.isSection && d.section && d.section.quote) {
        onChildClick(
          {
            id: d.section.id,
            title: d.section.title,
            quote: d.section.quote,
            keywords: [],
          },
          d.section
        );
      }
    },
    [onChildClick]
  );

  // Empty state — no PDF imported yet
  if (!outline) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-muted">
        <div className="text-center text-muted-foreground px-6">
          <Network className="h-10 w-10 mx-auto opacity-40 mb-2" />
          <p className="text-sm font-medium">导入 PDF 后自动生成思维导图</p>
          <p className="text-[11px] mt-1 text-muted-foreground/70">
            以 6 维度大纲为骨架，可视化论文结构
          </p>
        </div>
      </div>
    );
  }

  // Loading state — outline exists but sections not yet populated
  if (!outline.sections || outline.sections.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-muted">
        <div className="text-center text-muted-foreground px-6">
          <Loader2 className="h-6 w-6 mx-auto animate-spin mb-2 text-primary" />
          <p className="text-sm font-medium">正在分析…</p>
          <p className="text-[11px] mt-1 text-muted-foreground/70">
            Agent 正在生成 6 维度结构化大纲
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-muted relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background
          color="#E5E9EE"
          gap={20}
          variant={BackgroundVariant.Dots}
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            (n.data as unknown as DimNodeData).dimColor ||
            MINIMAP_DEFAULT_COLOR
          }
          nodeStrokeWidth={2}
          maskColor="rgba(100, 116, 139, 0.1)"
          style={{ borderRadius: 8 }}
          ariaLabel="思维导图缩略图"
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
