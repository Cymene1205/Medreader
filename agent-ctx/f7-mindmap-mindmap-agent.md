# Task f7-mindmap — Mindmap Agent

## Task
Implement Feature 7 (思维导图 / Mindmap) for the MedReader Agent Next.js 16 project. Create two files:
1. `src/lib/outline-to-flow.ts` — convert `Outline` JSON into reactflow nodes+edges with dagre LR layout
2. `src/components/mindmap-view.tsx` — client component rendering the reactflow mindmap with a custom `dimNode` renderer

## Work Log
- Read existing `src/components/outline-panel.tsx` to confirm the `Outline` / `OutlineSection` / `OutlineChild` types and their fields.
- Read `src/app/page.tsx` to confirm how `<MindmapView outline onChildClick />` is consumed inside the mindmap tab.
- Verified `@xyflow/react` v12 and `@dagrejs/dagre` v3 are installed; inspected their type exports (`Node`, `Edge`, `NodeProps`, `BackgroundVariant`, `Handle`, `Position`, `useNodesState`, `useEdgesState`, `Graph`, `rankdir: "LR"`).
- Created `src/lib/outline-to-flow.ts`:
  - Exported `FlowNode` / `FlowEdge` types (extended `data` with `isRoot`, `index`, `hasDetail` to faithfully encode the spec's "include data.summary, data.index, data.dimColor, data.detail flag" instruction while remaining backwards-compatible with the required shape).
  - Built a 3-level tree: root (`type: "input"`, paper title or `"论文"`, neutral slate `#475569`), sections (`type: "default"`, dim-1..6 colors with `borderLeft: 4px solid dimColor`), children (`type: "output"`, lighter tint of parent dim via a `lighten()` helper).
  - Edges use `type: "smoothstep"`, root→section colored by dim, section→child dim with opacity 0.55.
  - Ran dagre with `rankdir: "LR"`, `nodesep: 28`, `ranksep: 90`, `marginx/y: 24`; converted dagre center coords to ReactFlow top-left coords.
  - Section data carries `summary`, `dimColor`, `index`, `hasDetail`, `section`; child data carries `child` + `section` so the click handler can fire `onChildClick`.
- Created `src/components/mindmap-view.tsx`:
  - `"use client"`; imports `ReactFlow`, `Background`, `Controls`, `MiniMap`, `Handle`, `Position`, `useNodesState`, `useEdgesState` from `@xyflow/react` plus `import "@xyflow/react/dist/style.css"`.
  - `useMemo` over `outlineToFlow(outline)` to recompute layout on outline change; syncs into `useNodesState` / `useEdgesState` via `useEffect`.
  - Custom `DimNode` renderer (memoized) branches on `data.isRoot` / `data.isSection` / child presence. Section card shows dim number badge + title + 1-line summary with a 4px colored left border; child card uses the lighter dim background.
  - `nodeTypes` maps `input` / `default` / `output` / `dimNode` to `DimNode` so the type fields produced by `outline-to-flow.ts` are honored while still using a single custom renderer.
  - `onNodeClick` fires `onChildClick(data.child, data.section)` for child nodes, and synthesizes `{id, title, quote, keywords: []}` for section nodes that have a `quote`.
  - ReactFlow props: `fitView`, `proOptions={{ hideAttribution: true }}`, `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={true}`.
  - `<Background color="#E5E9EE" gap={20} variant={BackgroundVariant.Dots} />`, `<MiniMap pannable zoomable nodeColor={data.dimColor || fallback} />`, `<Controls />`.
  - Canvas wrapped in `bg-muted` (light gray) per spec.
  - Empty state: `outline === null` → "导入 PDF 后自动生成思维导图"; sections empty → "正在分析…".
- Ran `bun run lint` → no errors.
- Ran `tsc --noEmit` → no errors in my files (pre-existing errors in `examples/`, `skills/`, `src/lib/deepseek.ts` are unrelated).
- Verified dev log shows `GET / 200` after the new files were created.

## Stage Summary
Feature 7 mindmap is fully implemented. The `outlineToFlow` helper produces a 3-level horizontal tree (root → 6 dim sections → children) with dagre LR layout and smoothstep edges, color-coded by dimension. The `MindmapView` component renders it with a custom `DimNode` renderer, a dotted `#E5E9EE` background, a colored MiniMap, and Controls. Clicking a child or a section-with-quote triggers the parent's `onChildClick` to jump to the PDF highlight. Both empty states are handled. No new packages were installed and no other files were modified.
