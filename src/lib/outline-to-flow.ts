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
    detail?: string;
    keyPoints?: string[];
    quote?: string;
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

// Node sizing used both for rendering hints and dagre layout.
//
// These dimensions MUST match the actual rendered node sizes (set in the
// `style` prop of the node and in `MindmapView`'s DimNode component).
// If dagre thinks a node is smaller than it actually is, sibling nodes
// will visually overlap. The previous values were too small for sections
// that include title + 2-line summary + 3 keyPoints bullets, causing the
// classic "box overlap" the user reported on long outlines.
const ROOT_SIZE = { width: 220, height: 90 };
const SECTION_SIZE = { width: 300, height: 220 };
const CHILD_SIZE = { width: 240, height: 110 };

// Dagre layout configuration.
// `nodesep` = vertical gap between sibling nodes in the same rank
// `ranksep` = horizontal gap between ranks (root → section → child)
//
// Tuned to avoid box overlap when sections have many children. The
// previous values (nodesep: 28, ranksep: 90) caused sibling boxes to
// visually collide when a section had 4+ children. Bumped substantially
// to give each box clear separation even when the section node's actual
// rendered height exceeds the dagre hint.
const DAGRE_CONFIG = {
  rankdir: "LR" as const,
  nodesep: 80,
  ranksep: 180,
  marginx: 48,
  marginy: 48,
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
    // IMPORTANT: only sizing goes here. The visual styling (border,
    // background, padding, typography) is rendered by the DimNode component
    // inside MindmapView. If we also set border/background here, ReactFlow's
    // node wrapper gets its OWN box, which then offsets from the inner
    // DimNode box (because of the padding below) and creates the
    // "two stacked offset rectangles" visual bug the user reported.
    // Keeping just width/minHeight makes the wrapper transparent and lets
    // DimNode be the single visible layer.
    style: {
      width: `${ROOT_SIZE.width}px`,
      minHeight: `${ROOT_SIZE.height}px`,
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
        detail: section.detail,
        keyPoints: section.keyPoints,
        quote: section.quote,
        dimColor,
        isSection: true,
        index: idx,
        hasDetail: !!section.detail,
        section,
      },
      style: {
        width: `${SECTION_SIZE.width}px`,
        minHeight: `${SECTION_SIZE.height}px`,
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
          width: `${CHILD_SIZE.width}px`,
          minHeight: `${CHILD_SIZE.height}px`,
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
