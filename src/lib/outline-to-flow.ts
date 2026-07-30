import dagre from "@dagrejs/dagre";
import type { CSSProperties } from "react";
import type {
  Outline,
  OutlineChild,
  OutlineSection,
} from "@/components/outline-panel";

export type FlowNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: {
    label: string;
    summary?: string;
    dimColor?: string;
    isSection?: boolean;
    isRoot?: boolean;
    index?: number;
    hasDetail?: boolean;
    child?: OutlineChild;
    section?: OutlineSection;
  };
  style?: CSSProperties;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  style?: CSSProperties;
};

// Dimension colors for the 6 sections (dim-1 through dim-6)
export const DIM_COLORS: string[] = [
  "#2C5F8D", // dim-1
  "#3F8E83", // dim-2
  "#6B5B95", // dim-3
  "#C08552", // dim-4
  "#5B8C5A", // dim-5
  "#B0546E", // dim-6
];

// Neutral dark color used for the root (paper title) node
const ROOT_COLOR = "#475569";

// Default MiniMap fallback color
const MINIMAP_FALLBACK = "#94A3B8";

// Node sizing used both for rendering hints and dagre layout
const ROOT_SIZE = { width: 200, height: 64 };
const SECTION_SIZE = { width: 240, height: 92 };
const CHILD_SIZE = { width: 200, height: 60 };

// Dagre layout configuration
const DAGRE_CONFIG = {
  rankdir: "LR" as const,
  nodesep: 28,
  ranksep: 90,
  marginx: 24,
  marginy: 24,
};

function dimColorFor(index: number): string {
  return DIM_COLORS[index % DIM_COLORS.length];
}

// Mix a hex color with white to produce a lighter tint
// amount = 0 returns the original color, amount = 1 returns pure white
function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, "0")}${lg
    .toString(16)
    .padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

/**
 * Convert an `Outline` into reactflow nodes + edges, with positions
 * computed by dagre (horizontal LR tree).
 *
 * Layout structure:
 *   - Level 1: root node (paper title)
 *   - Level 2: section nodes (one per outline section, colored by dim index)
 *   - Level 3: child nodes (section.children, lighter tint of parent dim)
 */
export function outlineToFlow(
  outline: Outline | null
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (!outline || !outline.sections || outline.sections.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // Root node ------------------------------------------------------------
  const rootId = "root";
  const rootLabel = outline.title?.trim() || "论文";
  nodes.push({
    id: rootId,
    type: "input",
    position: { x: 0, y: 0 },
    data: {
      label: rootLabel,
      dimColor: ROOT_COLOR,
      isRoot: true,
    },
    style: {
      border: `1px solid ${ROOT_COLOR}`,
      background: ROOT_COLOR,
      color: "#FFFFFF",
      padding: "10px 14px",
      fontSize: "14px",
      fontWeight: 600,
      borderRadius: "8px",
      width: `${ROOT_SIZE.width}px`,
    },
  });

  // Section + child nodes ------------------------------------------------
  outline.sections.forEach((section, idx) => {
    const dimColor = dimColorFor(idx);
    const sectionId = `section-${section.id}`;

    nodes.push({
      id: sectionId,
      type: "default",
      position: { x: 0, y: 0 },
      data: {
        label: section.title,
        summary: section.summary,
        dimColor,
        isSection: true,
        index: idx,
        hasDetail: !!section.detail,
        section,
      },
      style: {
        border: `1px solid ${dimColor}`,
        borderLeft: `4px solid ${dimColor}`,
        background: "#FFFFFF",
        padding: "10px 12px 10px 14px",
        fontSize: "13px",
        fontWeight: 500,
        borderRadius: "8px",
        width: `${SECTION_SIZE.width}px`,
      },
    });

    edges.push({
      id: `e-${rootId}-${sectionId}`,
      source: rootId,
      target: sectionId,
      type: "smoothstep",
      style: { stroke: dimColor, strokeWidth: 1.6 },
    });

    // Child nodes (lighter tint of the section's dim color)
    const childBg = lighten(dimColor, 0.82);
    const childBorder = lighten(dimColor, 0.55);

    section.children.forEach((child) => {
      const childId = `child-${child.id}`;
      nodes.push({
        id: childId,
        type: "output",
        position: { x: 0, y: 0 },
        data: {
          label: child.title,
          summary: child.summary,
          dimColor: childBg,
          child,
          section,
        },
        style: {
          border: `1px solid ${childBorder}`,
          background: childBg,
          padding: "8px 12px",
          fontSize: "12px",
          fontWeight: 500,
          borderRadius: "8px",
          width: `${CHILD_SIZE.width}px`,
        },
      });

      edges.push({
        id: `e-${sectionId}-${childId}`,
        source: sectionId,
        target: childId,
        type: "smoothstep",
        style: { stroke: dimColor, strokeWidth: 1, opacity: 0.55 },
      });
    });
  });

  // Layout with dagre ----------------------------------------------------
  const g = new dagre.graphlib.Graph();
  g.setGraph(DAGRE_CONFIG);
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    let width = CHILD_SIZE.width;
    let height = CHILD_SIZE.height;
    if (node.data.isRoot) {
      width = ROOT_SIZE.width;
      height = ROOT_SIZE.height;
    } else if (node.data.isSection) {
      width = SECTION_SIZE.width;
      height = SECTION_SIZE.height;
    }
    g.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  // Dagre returns the node center; ReactFlow expects the top-left position
  nodes.forEach((node) => {
    const laid = g.node(node.id);
    if (laid) {
      node.position = {
        x: laid.x - laid.width / 2,
        y: laid.y - laid.height / 2,
      };
    }
  });

  return { nodes, edges };
}

// Re-export helper for the MiniMap fallback color
export const MINIMAP_DEFAULT_COLOR = MINIMAP_FALLBACK;
