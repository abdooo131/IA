# Graph Report - IA  (2026-10-03)

## Corpus Check
- Corpus is ~1,326 words - fits in a single context window. You may not need a graph.

## Summary
- 67 nodes · 112 edges · 6 communities (2 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Raw Material Costing
- Login and Entry Forms
- Style and Material Tables
- Console Entry Point

## God Nodes (most connected - your core abstractions)
1. `CutType` - 9 edges
2. `LoginGui` - 7 edges
3. `RawMaterials` - 7 edges
4. `AddRm` - 6 edges
5. `Consumption` - 6 edges
6. `MainApp` - 6 edges
7. `ViewRmGUI` - 6 edges
8. `Style` - 3 edges
9. `StylePanel` - 3 edges
10. `Main` - 2 edges

## Surprising Connections (you probably didn't know these)
- `RawMaterials` --references--> `Consumption`  [EXTRACTED]
  src/RawMaterials.java → src/Consumption.java
- `RawMaterials` --references--> `CutType`  [EXTRACTED]
  src/RawMaterials.java → src/Consumption.java
- `Style` --references--> `RawMaterials`  [EXTRACTED]
  src/Style.java → src/RawMaterials.java

## Import Cycles
- None detected.

## Communities (6 total, 4 thin omitted)

### Community 1 - "Raw Material Costing"
Cohesion: 0.20
Nodes (8): Consumption, CutType, CM, GM, KG, PU, RawMaterials, Style

### Community 2 - "Login and Entry Forms"
Cohesion: 0.20
Nodes (3): AddRm, LoginGui, MainApp

## Knowledge Gaps
- **4 isolated node(s):** `CM`, `GM`, `PU`, `KG`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 30 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LoginGui` connect `Login and Entry Forms` to `Swing UI Widgets`, `Style and Material Tables`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `Style` connect `Raw Material Costing` to `Console Entry Point`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **What connects `CM`, `GM`, `PU` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._