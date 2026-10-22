# 3DForge 0.3

**Live demo:** <https://oth-aw-meiller.github.io/3D-Forge/>

A small browser-based box & mesh modeler built with [three.js](https://threejs.org) (v0.160, loaded via CDN as ES modules). No build step, no dependencies to install.

## Run

ES modules need an HTTP server (opening `index.html` via `file://` will not work):

```sh
python3 -m http.server 8765
```

Then open <http://localhost:8765/index.html>. An internet connection is required for the three.js CDN.

## Features

### Scene & navigation
- Rotatable 3D view (orbit), Blender-style navigation with the middle mouse button (drag = orbit, `Shift`+drag = pan, `Ctrl`+drag = zoom; mouse wheel also zooms); a navigation gizmo at the top right (click an axis to snap the view, drag to orbit) with zoom and pan drag buttons below it, orbiting and zooming around the selected pivot, with a ground grid and axes
- Pivot options: orbit around the origin or the current selection; "Center" focuses the view on the pivot, "Home" (`Home`) resets the view to the initial position
- Optional grid snapping (units configurable, 0 = off)

### Primitives
- Box, sphere, cylinder and tube, placed by clicking in the 3D view with a live preview
- Per-shape parameters (e.g. size, subdivisions) and a colour for new objects

### Object mode
- Select, move, rotate and scale with a gizmo (global or local orientation)
- A yellow frame shows the extent of the selected object(s)
- Multi-selection: `Shift`/`Ctrl`/`Cmd`+click in the view or in the object list toggles objects, `Ctrl+A` selects all; the gizmo transforms the whole selection, and duplicate, delete and colour apply to all selected objects
- Numeric position / scale / rotation / colour fields in the side panel; all number fields can be changed by dragging the mouse up/down inside them (`Shift` = fine)
- Duplicate and delete objects
- **Bool**: with exactly two objects selected, combine them with Add (A + B) or Subtract (A − B), where A is the first selected object; the result is a new editable mesh (BSP-based CSG, face colours are not kept)
- **Edges** (Shift+H): hides the edges between faces of the selected objects whose angle is below a limit (default 30°) by merging those faces
- **Close holes** (Shift+K): fills open boundary loops of the selected objects, so the mesh becomes closed
- Scrollable object list with rename (double-click) and selection
- Undo / redo for the whole scene

### Edit mode (vertices, edges, faces)
- Convert any primitive into an editable mesh and edit **vertices**, **edges** or **faces**
- Move, rotate and scale selections; selected edges are highlighted
- **Add**: new vertices, edges between two selected points, face extrusion
- **Remove**: delete vertices, edges (merging faces) or faces
- **Connect** boundary points of the same face
- **Chamfer** selected edges with adjustable width
- **Subdivide** the selected faces with Catmull-Clark subdivision surfaces (one level per click, `Shift+D`; disabled without a face selection)
- **Mirror** on X, Y and/or Z so edits are applied to both sides; enabled mirror planes are shown in the viewport
- Per-face colours (with reset to the object colour)
- Added edges are always visible; Add / Remove / Chamfer are disabled when not applicable

### Import / export
| Format | Import | Export | Notes |
|--------|:------:|:------:|-------|
| JSON (3DForge) | ✓ | ✓ | Lossless, includes face colours |
| glTF / GLB | ✓ | ✓ | Face colours are kept via vertex colours |
| OBJ | ✓ | ✓ | No materials / colours |
| STL | ✓ | ✓ | No colours |
| 3DS | ✓ | ✓ | No transformation matrices |

Imported meshes become editable objects with their centre as origin.

### Usability
- Splash screen and logo (click the logo to show it again)
- Keyboard shortcuts for the whole workflow, shown in hover tooltips, next to menu items, and in **Help → Keyboard shortcuts** (`?`)
- Help dialogs for controls and edit mode (`F1`, `Shift+F1`)

## Keyboard shortcuts (overview)

`Ctrl` also means `Cmd` on macOS.

| Action | Keys |
|--------|------|
| Open / save JSON | `Ctrl+O` / `Ctrl+S` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` |
| Select mode / create box, sphere, cylinder, tube | `1` / `2`–`5` |
| Toggle edit mode | `Tab` |
| Move / rotate / scale | `W` / `E` / `R` |
| Gizmo global / local | `X` |
| Duplicate / delete | `Ctrl+D` / `Del` |
| Center view on pivot | `F` |
| Edit mode: vertex / edge / face | `1` / `2` / `3` |
| Edit mode: add / remove / chamfer | `Enter` / `Del` / `B` |
| Edit mode: mirror X / Y / Z | `Shift+X` / `Shift+Y` / `Shift+Z` |

The complete, always up-to-date list is in the app (`?`).

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Layout, styles, menus, dialogs |
| `main.js` | App logic: modes, toolbar, panels, object list, undo/redo |
| `stage.js` | Scene, camera, renderer, orbit controls, grid |
| `shapes.js` | Parametric primitives |
| `subedit.js` | Sub-object editor (vertex / edge / face) core |
| `model.js`, `polygon.js` | Editable mesh model and polygon helpers |
| `edit-mirror.js`, `edit-topology.js`, `edit-chamfer.js`, `edit-extrude.js`, `edit-subdivide.js` | Editor features, mixed into the editor |
| `csg.js` | Boolean (CSG) algorithm for meshes |
| `io.js` | Import / export, including a minimal 3DS reader/writer |
| `shortcuts.js` | Shortcut registry, tooltips and shortcut table |
| `splash.js` | Splash screen |

## Limitations
- Chamfer works only on edges shared by exactly two faces; Connect only on boundary points of one face
- The mirror setting is not stored in undo history or files
- OBJ is exported without `.mtl`; OBJ / STL / 3DS do not keep face colours
