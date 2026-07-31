"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network, Loader2 } from "lucide-react";
import dagre from "@dagrejs/dagre";
import type { Outline, OutlineChild, OutlineSection } from "@/components/outline-panel";
import type { Figure } from "@/components/figure-chain";

type MindmapViewProps = {
  outline: Outline | null;
  figures?: Figure[];
  onChildClick: (child: OutlineChild, section: OutlineSection) => void;
  onFigureClick?: (figureLabel: string) => void;
};

// ── Layout config ─────────────────────────────────────────────────────────

const ROOT_COLOR = "#475569";

const BRANCH_COLORS: Record<string, string> = {
  questionBackground: "#2563EB",
  argumentSpine: "#0D9488",
  novelty: "#9333EA",
  limitsOpportunities: "#EA580C",
};

const BRANCH_TITLES: Record<string, string> = {
  questionBackground: "问题与背景",
  argumentSpine: "论证主线",
  novelty: "创新性",
  limitsOpportunities: "局限与机会",
};

const ROOT_SIZE = { width: 260, height: 110 };
const SECTION_SIZE = { width: 320, height: 200 };
const CHILD_SIZE = { width: 260, height: 120 };
const FIGURE_SIZE = { width: 220, height: 100 };

const DAGRE_CONFIG = {
  rankdir: "LR" as const,
  nodesep: 70,
  ranksep: 180,
  marginx: 60,
  marginy: 60,
};

const MINIMAP_DEFAULT_COLOR = "#94A3B8";

// ── Types for our flow nodes ──────────────────────────────────────────────

type FlowNodeData = {
  label: string;
  summary?: string;
  dimColor?: string;
  isRoot?: boolean;
  isSection?: boolean;
  isFigure?: boolean;
  isLinchpin?: boolean;
  isSubtitle?: boolean;
  isSpineSummary?: boolean;
  index?: number;
  // Legacy — kept so old onChildClick signature still works
  child?: OutlineChild;
  section?: OutlineSection;
  // New — figure reference
  figureLabel?: string;
};

type FlowNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: FlowNodeData;
  style?: React.CSSProperties;
};

type FlowEdge = {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  style?: React.CSSProperties;
};

// ── Build the flow from new 4-layer outline + figures ────────────────────

function buildFlow(
  outline: Outline | null,
  figures: Figure[]
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (!outline) return { nodes: [], edges: [] };

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // Root — paper title (always show FULL title, no truncation)
  const rootId = "root";
  const rootTitle = outline.title || "论文";
  // Estimate root node height based on title length so long titles get
  // enough vertical space (rough heuristic: 22 chars per line at width 260).
  const rootLines = Math.max(2, Math.ceil(rootTitle.length / 22));
  const rootHeight = Math.max(ROOT_SIZE.height, rootLines * 26 + 24);
  nodes.push({
    id: rootId,
    type: "input",
    position: { x: 0, y: 0 },
    data: {
      label: rootTitle,
      dimColor: ROOT_COLOR,
      isRoot: true,
    },
    style: { width: `${ROOT_SIZE.width}px`, minHeight: `${rootHeight}px` },
  });

  const branchKeys = ["questionBackground", "argumentSpine", "novelty", "limitsOpportunities"] as const;

  branchKeys.forEach((key, idx) => {
    const sectionId = `sec-${key}`;
    const color = BRANCH_COLORS[key];
    const title = BRANCH_TITLES[key];

    // Check if this section has content
    const part = (outline as any)[key];
    const hasFigures = key === "argumentSpine" && figures.length > 0;
    const hasContent = part && (part.summary || part.detail || hasFigures);
    if (!hasContent) return;

    // Section node
    nodes.push({
      id: sectionId,
      type: "default",
      position: { x: 0, y: 0 },
      data: {
        label: title,
        summary: part?.summary,
        dimColor: color,
        isSection: true,
        index: idx,
      },
      style: { width: `${SECTION_SIZE.width}px`, minHeight: `${SECTION_SIZE.height}px` },
    });
    edges.push({
      id: `e-${rootId}-${sectionId}`,
      source: rootId,
      target: sectionId,
      style: { stroke: color, strokeWidth: 2 },
    });

    // argumentSpine: ALWAYS show figure nodes AND summary-as-bullet so the
    // user sees both the chain of figures AND the textual narrative.
    // (Previously: figures-only → rich detail text was lost.)
    if (key === "argumentSpine") {
      // 1) Figure child nodes (sorted by chainIndex then order)
      if (figures.length > 0) {
        const sortedFigs = [...figures].sort((a, b) => {
          if (a.chainIndex == null && b.chainIndex == null) return a.order - b.order;
          if (a.chainIndex == null) return 1;
          if (b.chainIndex == null) return -1;
          return a.chainIndex - b.chainIndex;
        });
        sortedFigs.forEach((fig) => {
          const figNodeId = `fig-${fig.label.replace(/\s+/g, "_")}`;
          nodes.push({
            id: figNodeId,
            type: "default",
            position: { x: 0, y: 0 },
            data: {
              label: `${fig.label}${fig.isLinchpin ? " ⚡" : ""}`,
              summary: fig.question || (fig.caption || "").slice(0, 100),
              dimColor: fig.isLinchpin ? "#E11D48" : color,
              isFigure: true,
              isLinchpin: fig.isLinchpin,
              figureLabel: fig.label,
            },
            style: {
              width: `${FIGURE_SIZE.width}px`,
              minHeight: `${FIGURE_SIZE.height}px`,
              ...(fig.isLinchpin ? { borderColor: "#E11D48" } : {}),
            },
          });
          edges.push({
            id: `e-${sectionId}-${figNodeId}`,
            source: sectionId,
            target: figNodeId,
            style: {
              stroke: fig.isLinchpin ? "#E11D48" : color,
              strokeWidth: fig.isLinchpin ? 2 : 1,
            },
          });
        });
      }
      // 2) Also add summary as a text child node (if present)
      const spineSummary = part?.summary;
      if (spineSummary && spineSummary.trim().length > 0) {
        const sumNodeId = `spine-summary-${key}`;
        nodes.push({
          id: sumNodeId,
          type: "default",
          position: { x: 0, y: 0 },
          data: {
            label: spineSummary.slice(0, 200),
            dimColor: color,
            isSpineSummary: true,
          },
          style: { width: `${CHILD_SIZE.width}px`, minHeight: `${CHILD_SIZE.height}px` },
        });
        edges.push({
          id: `e-${sectionId}-${sumNodeId}`,
          source: sectionId,
          target: sumNodeId,
          style: { stroke: color, strokeWidth: 1.5, strokeDasharray: "4 3" },
        });
      }
    } else {
      // For other branches — split detail Markdown into bullet children.
      // Recognize `-`, `*`, AND numbered list items (`1.`, `2.`, etc.).
      // Also pick up `### Subtitle` lines as their own nodes for richer map.
      const detail = part?.detail;
      if (detail) {
        const lines = detail.split(/\n/).map((l: string) => l.trim());
        const bullets: { text: string; isSubtitle: boolean }[] = [];
        for (const l of lines) {
          if (!l) continue;
          // Markdown subtitle: ### xxx or ## xxx
          const subMatch = l.match(/^#{2,3}\s+(.+)$/);
          if (subMatch) {
            const t = subMatch[1].replace(/\*\*/g, "").trim();
            if (t.length > 2) bullets.push({ text: t, isSubtitle: true });
            continue;
          }
          // Bullet: - xxx or * xxx
          const bulMatch = l.match(/^[-*]\s+(.+)$/);
          if (bulMatch) {
            const t = bulMatch[1].replace(/\*\*/g, "").trim();
            if (t.length > 5) bullets.push({ text: t, isSubtitle: false });
            continue;
          }
          // Numbered: 1. xxx
          const numMatch = l.match(/^\d+\.\s+(.+)$/);
          if (numMatch) {
            const t = numMatch[1].replace(/\*\*/g, "").trim();
            if (t.length > 5) bullets.push({ text: t, isSubtitle: false });
            continue;
          }
        }
        // Allow up to 6 bullets, and slice text to 120 chars (was 60).
        const picked = bullets.slice(0, 6);
        picked.forEach((b, bIdx) => {
          const childId = `child-${key}-${bIdx}`;
          nodes.push({
            id: childId,
            type: "default",
            position: { x: 0, y: 0 },
            data: {
              label: b.text.slice(0, 120),
              dimColor: color,
              isSubtitle: b.isSubtitle,
            },
            style: { width: `${CHILD_SIZE.width}px`, minHeight: `${CHILD_SIZE.height}px` },
          });
          edges.push({
            id: `e-${sectionId}-${childId}`,
            source: sectionId,
            target: childId,
            style: { stroke: color, strokeWidth: 1 },
          });
        });
      }
    }
  });

  // Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setGraph(DAGRE_CONFIG);
  g.setDefaultEdgeLabel(() => ({}));

  const nodeSizeMap: Record<string, { width: number; height: number }> = {};
  for (const n of nodes) {
    const w = parseInt(String(n.style?.width || "200px")) || 200;
    const h = parseInt(String(n.style?.minHeight || "100px")) || 100;
    nodeSizeMap[n.id] = { width: w, height: h };
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const layoutedNodes = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: pos
        ? { x: pos.x - nodeSizeMap[n.id].width / 2, y: pos.y - nodeSizeMap[n.id].height / 2 }
        : { x: 0, y: 0 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ── Custom node renderer ──────────────────────────────────────────────────

const hiddenHandle: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  pointerEvents: "none",
};

const DimNode = memo(function DimNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;

  // Root node — paper title. Show FULL title (no line-clamp), with a
  // "论文" badge above so the user immediately knows this is the article.
  if (d.isRoot) {
    const bg = d.dimColor || ROOT_COLOR;
    return (
      <div
        className="rounded-lg px-3 py-2.5 text-white shadow-md"
        style={{
          background: `linear-gradient(135deg, ${bg} 0%, ${bg}DD 100%)`,
          border: `1px solid ${bg}`,
          width: 260,
          minHeight: 110,
          boxShadow: selected
            ? `0 0 0 3px ${bg}55, 0 4px 12px ${bg}33`
            : `0 2px 8px ${bg}22`,
        }}
      >
        <Handle type="source" position={Position.Right} style={hiddenHandle} />
        <div className="text-[9px] uppercase tracking-wider opacity-70 mb-1 font-medium">
          Paper Title
        </div>
        <div className="text-[13px] font-semibold leading-snug">{d.label}</div>
      </div>
    );
  }

  // Figure node
  if (d.isFigure) {
    const color = d.dimColor || "#0D9488";
    return (
      <div
        className="rounded-lg px-2.5 py-2 shadow-sm"
        style={{
          background: "#fff",
          border: `2px solid ${color}`,
          width: 220,
          minHeight: 100,
          boxShadow: selected ? `0 0 0 3px ${color}55` : undefined,
        }}
      >
        <Handle type="target" position={Position.Left} style={hiddenHandle} />
        <div className="text-[11.5px] font-bold leading-tight" style={{ color }}>
          {d.label}
        </div>
        {d.summary && (
          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-3 leading-snug">
            {d.summary}
          </div>
        )}
        <Handle type="source" position={Position.Right} style={hiddenHandle} />
      </div>
    );
  }

  // Section node
  if (d.isSection) {
    const color = d.dimColor || "#2563EB";
    return (
      <div
        className="rounded-lg bg-white shadow-sm flex overflow-hidden"
        style={{
          border: `1px solid ${color}`,
          borderLeft: `5px solid ${color}`,
          width: 320,
          minHeight: 200,
          boxShadow: selected ? `0 0 0 3px ${color}44` : undefined,
        }}
      >
        <Handle type="target" position={Position.Left} style={hiddenHandle} />
        <div className="px-3 py-2.5 flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <span
              className="flex-shrink-0 w-6 h-6 rounded-md text-[11px] font-bold flex items-center justify-center mt-0.5 text-white shadow-sm"
              style={{ background: color }}
              aria-hidden
            >
              {(d.index ?? 0) + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold leading-snug text-foreground">
                {d.label}
              </div>
              {d.summary && (
                <div className="text-[11px] text-muted-foreground mt-1 line-clamp-4 leading-relaxed">
                  {d.summary}
                </div>
              )}
            </div>
          </div>
        </div>
        <Handle type="source" position={Position.Right} style={hiddenHandle} />
      </div>
    );
  }

  // Spine summary node (argumentSpine narrative text)
  if (d.isSpineSummary) {
    const bg = d.dimColor || "#0D9488";
    return (
      <div
        className="rounded-lg px-2.5 py-2 shadow-sm"
        style={{
          background: `${bg}10`,
          border: `1px dashed ${bg}`,
          width: 260,
          minHeight: 120,
          boxShadow: selected ? `0 0 0 2px ${bg}55` : undefined,
        }}
      >
        <Handle type="target" position={Position.Left} style={hiddenHandle} />
        <div className="text-[9px] uppercase tracking-wider opacity-60 mb-1 font-medium" style={{ color: bg }}>
          论证主线
        </div>
        <div className="text-[11px] font-medium leading-relaxed text-foreground/90">
          {d.label}
        </div>
        <Handle type="source" position={Position.Right} style={hiddenHandle} />
      </div>
    );
  }

  // Child node
  const bg = d.dimColor || "#F1F5F9";
  return (
    <div
      className="rounded-lg px-2.5 py-2 shadow-sm"
      style={{
        background: d.isSubtitle ? `${bg}25` : `${bg}12`,
        border: d.isSubtitle ? `1.5px solid ${bg}80` : `1px solid ${bg}40`,
        width: 260,
        minHeight: 120,
        boxShadow: selected ? `0 0 0 2px ${bg}55` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandle} />
      {d.isSubtitle && (
        <div className="text-[9px] uppercase tracking-wider opacity-60 mb-0.5 font-medium" style={{ color: bg }}>
          小标题
        </div>
      )}
      <div className="text-[11.5px] font-medium leading-snug text-foreground/90 line-clamp-4">
        {d.label}
      </div>
      <Handle type="source" position={Position.Right} style={hiddenHandle} />
    </div>
  );
});

DimNode.displayName = "DimNode";

const nodeTypes = {
  input: DimNode,
  default: DimNode,
  output: DimNode,
  dimNode: DimNode,
};

// ── Main component ────────────────────────────────────────────────────────

export default function MindmapView({
  outline,
  figures = [],
  onChildClick,
  onFigureClick,
}: MindmapViewProps) {
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => buildFlow(outline, figures),
    [outline, figures]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges as Edge[]);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  // Track previous node count — re-fit view when structure changes significantly
  // (e.g., figures loaded late, outline sections populated).
  const prevNodeCountRef = useRef(0);

  useEffect(() => {
    setNodes(layoutedNodes as Node[]);
    setEdges(layoutedEdges as Edge[]);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Re-fit view when node count changes (figures arrived, etc.)
  useEffect(() => {
    const curCount = (layoutedNodes as Node[]).length;
    if (
      curCount !== prevNodeCountRef.current &&
      curCount > 0 &&
      rfInstance
    ) {
      prevNodeCountRef.current = curCount;
      // Defer fitView to next tick so the new nodes have been laid out.
      const t = setTimeout(() => rfInstance.fitView({ padding: 0.18, duration: 300 }), 60);
      return () => clearTimeout(t);
    }
  }, [layoutedNodes, rfInstance]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const d = node.data as unknown as FlowNodeData;
      // Figure node — call onFigureClick if provided
      if (d.isFigure && d.figureLabel) {
        onFigureClick?.(d.figureLabel);
        return;
      }
      // Section node — fire a synthetic onChildClick using summary as quote
      if (d.isSection && d.summary) {
        onChildClick(
          {
            id: `section-${d.label}`,
            title: d.label,
            quote: d.summary.slice(0, 30),
            keywords: [],
          },
          {
            id: `section-${d.label}`,
            title: d.label,
            summary: d.summary,
            children: [],
          }
        );
      }
    },
    [onChildClick, onFigureClick]
  );

  // Empty state
  if (!outline) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-muted">
        <div className="text-center text-muted-foreground px-6">
          <Network className="h-10 w-10 mx-auto opacity-40 mb-2" />
          <p className="text-sm font-medium">导入 PDF 后自动生成思维导图</p>
          <p className="text-[11px] mt-1 text-muted-foreground/70">
            以 4 层分析为骨架，可视化论文结构
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  const hasAnyContent =
    outline.questionBackground ||
    outline.argumentSpine ||
    outline.novelty ||
    outline.limitsOpportunities ||
    figures.length > 0;

  if (!hasAnyContent) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-muted">
        <div className="text-center text-muted-foreground px-6">
          <Loader2 className="h-6 w-6 mx-auto animate-spin mb-2 text-primary" />
          <p className="text-sm font-medium">正在分析…</p>
          <p className="text-[11px] mt-1 text-muted-foreground/70">
            Agent 正在生成 4 层结构化分析
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
        onInit={setRfInstance}
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
        <Background color="#E5E9EE" gap={20} variant={BackgroundVariant.Dots} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            (n.data as unknown as FlowNodeData).dimColor || MINIMAP_DEFAULT_COLOR
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
