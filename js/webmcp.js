// WebMCP: exposes the app as tools for AI agents (navigator.modelContext.registerTool, W3C WebMCP draft).
// Every tool calls the same app functions as the UI. Without browser support the tools are still available
// as window.webmcp.call(name, args), which is also what the tests use.
import * as THREE from 'three';
import { edgeKey } from './model.js';

const num = { type: 'number' };
const vec3 = { type: 'array', items: num, minItems: 3, maxItems: 3, description: '[x, y, z]' };
const str = { type: 'string' };
const r3 = v => Math.round(v * 1000) / 1000;
const deg = r => r3(THREE.MathUtils.radToDeg(r));
const ok = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const fail = msg => ({ content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true });

export function registerWebMCP(app) {
  const { boxes, editor, SHAPES } = app;
  const tools = new Map();
  const define = (name, description, properties, handler, { required = [], readOnly = false } = {}) => {
    tools.set(name, {
      name, description, inputSchema: { type: 'object', properties, required },
      annotations: { readOnlyHint: readOnly },
      async execute(args = {}) {
        try { return ok(await handler(args)); } catch (e) { return fail(e.message || String(e)); }
      },
    });
  };
  const byName = name => {
    const m = boxes.find(b => b.userData.name === name);
    if (!m) throw new Error(`No object named "${name}"`);
    return m;
  };
  const objectMode = () => { if (app.mode() !== 'select') app.setMode('select'); };
  const needEdit = () => { if (app.mode() !== 'edit') throw new Error('Not in edit mode (use enter_edit_mode)'); };
  const describe = m => ({
    name: m.userData.name, type: m.userData.type, params: m.userData.custom ? undefined : m.userData.params,
    position: m.position.toArray().map(r3), rotationDeg: [m.rotation.x, m.rotation.y, m.rotation.z].map(deg), scale: m.scale.toArray().map(r3),
    color: app.baseHex(m), hidden: !!m.userData.hidden, locked: !!m.userData.locked, selected: app.selection().includes(m),
    editable: !!m.userData.custom,
  });
  const done = () => { app.commit(); app.refresh(); };

  // ---- Scene -------------------------------------------------------
  define('get_scene', 'Describe the scene: mode, active tool, selection and all objects (transforms in degrees).', {}, () => ({
    mode: app.mode(), tool: app.tool(), editKind: editor.kind, selection: app.selection().map(m => m.userData.name), objects: boxes.map(describe),
  }), { readOnly: true });

  define('list_shapes', 'List the primitive types and their parameters (key, default, min, max).', {}, () =>
    Object.fromEntries(Object.entries(SHAPES).map(([k, s]) => [k, s.fields.map(f => ({ key: f.key, label: f.label, default: f.def, min: f.min, max: f.max }))])), { readOnly: true });

  define('create_object', 'Create a primitive object and select it. Use list_shapes for types and parameters.', {
    type: { ...str, enum: Object.keys(SHAPES) }, params: { type: 'object', description: 'Shape parameters, see list_shapes', additionalProperties: num },
    position: vec3, color: { ...str, description: 'Hex color like #4c8bf5' }, name: str,
  }, a => {
    objectMode();
    const type = a.type || 'box';
    if (!SHAPES[type]) throw new Error(`Unknown type ${type}`);
    const mesh = app.addBox({ position: new THREE.Vector3(...(a.position || [0, 0, 0])), color: a.color || '#4c8bf5', type, params: { ...app.defaultParams(type), ...a.params }, name: a.name });
    app.select(mesh);
    done();
    return describe(mesh);
  });

  define('select_objects', 'Select objects by name (replaces the selection, or extends it with add=true). An empty list clears the selection.', {
    names: { type: 'array', items: str }, add: { type: 'boolean' },
  }, a => {
    objectMode();
    const list = (a.names || []).map(byName);
    app.setSelectionList(a.add ? [...new Set([...app.selection(), ...list])] : list);
    return { selection: app.selection().map(m => m.userData.name) };
  }, { required: ['names'] });

  define('delete_objects', 'Delete the named objects (or the current selection if no names are given).', { names: { type: 'array', items: str } }, a => {
    objectMode();
    if (a.names) app.setSelectionList(a.names.map(byName));
    if (!app.selection().length) throw new Error('Nothing selected');
    const n = app.selection().length;
    app.deleteSelected();
    return { deleted: n };
  });

  define('duplicate_objects', 'Duplicate the named objects (or the selection); the copies become the selection.', { names: { type: 'array', items: str } }, a => {
    objectMode();
    if (a.names) app.setSelectionList(a.names.map(byName));
    if (!app.selection().length) throw new Error('Nothing selected');
    app.duplicateSelected();
    return app.selection().map(describe);
  });

  define('rename_object', 'Rename an object.', { name: str, newName: str }, a => {
    const m = byName(a.name);
    if (boxes.some(b => b.userData.name === a.newName)) throw new Error('Name already in use');
    app.renameGroups(a.name, a.newName);
    m.userData.name = a.newName;
    app.syncList();
    app.commit();
    return describe(m);
  }, { required: ['name', 'newName'] });

  define('set_transform', 'Set position, rotation (degrees) and/or scale of an object. Omitted values stay unchanged.', {
    name: str, position: vec3, rotationDeg: vec3, scale: vec3,
  }, a => {
    objectMode();
    const m = byName(a.name);
    if (a.position) m.position.set(...a.position);
    if (a.rotationDeg) m.rotation.set(...a.rotationDeg.map(THREE.MathUtils.degToRad));
    if (a.scale) m.scale.set(...a.scale);
    done();
    return describe(m);
  }, { required: ['name'] });

  define('set_object_props', 'Set color, visibility or lock state of an object.', {
    name: str, color: str, hidden: { type: 'boolean' }, locked: { type: 'boolean' },
  }, a => {
    objectMode();
    const m = byName(a.name);
    if (a.color) { m.userData.baseColor.set(a.color); app.applyColors(m); }
    if (a.hidden !== undefined) { m.userData.hidden = a.hidden; m.visible = !a.hidden; }
    if (a.locked !== undefined) m.userData.locked = a.locked;
    app.syncList();
    done();
    return describe(m);
  }, { required: ['name'] });

  define('undo', 'Undo the last change.', {}, () => { app.undo(); return { objects: boxes.length }; });
  define('redo', 'Redo the last undone change.', {}, () => { app.redo(); return { objects: boxes.length }; });
  define('clear_scene', 'Remove all objects.', {}, () => { app.clearAll(); done(); return { objects: 0 }; });

  define('export_scene', 'Return the scene as project JSON (same format as File > Export).', {}, () => ({
    format: 'scene', objects: boxes.map(m => ({
      ...describe(m), rotation: [m.rotation.x, m.rotation.y, m.rotation.z].map(r3),
      ...(m.userData.custom && { positions: Array.from(m.userData.model.positions, v => Math.round(v * 1e4) / 1e4), faces: Array.from(m.userData.model.faceOfTri) }),
    })),
  }), { readOnly: true });

  // ---- Edit mode ---------------------------------------------------
  define('enter_edit_mode', 'Enter edit mode for an object (vertices / edges / faces).', {
    name: str, kind: { ...str, enum: ['vertex', 'edge', 'face'] },
  }, a => {
    if (app.mode() === 'edit') app.setMode('select');
    if (a.name) app.setSelectionList([byName(a.name)]);
    if (app.selection().length !== 1) throw new Error('Exactly one object must be selected (give a name)');
    app.setMode('edit');
    if (a.kind) app.setSub(a.kind);
    return { object: editor.mesh.userData.name, kind: editor.kind };
  });
  define('exit_edit_mode', 'Leave edit mode.', {}, () => { if (app.mode() === 'edit') app.setMode('select'); return { mode: app.mode() }; });
  define('set_edit_kind', 'Switch between vertex, edge and face editing.', { kind: { ...str, enum: ['vertex', 'edge', 'face'] } }, a => {
    needEdit(); app.setSub(a.kind); return { kind: editor.kind };
  }, { required: ['kind'] });

  const selState = () => ({
    object: editor.mesh.userData.name, kind: editor.kind,
    counts: { vertices: editor.model.nVerts, edges: editor.model.edges.length ?? editor.model.edges.size, faces: editor.model.faces.size },
    selection: { vertices: [...editor.selV], edges: [...editor.selE].map(k => { const e = editor.model.edgeByKey.get(k); return [e.a, e.b]; }), faces: [...editor.selF] },
  });
  define('get_edit_state', 'Counts and current sub-object selection in edit mode.', {}, () => { needEdit(); return selState(); }, { readOnly: true });

  define('get_edit_geometry', 'Vertices (world positions), edges and faces (vertex index lists) of the object in edit mode, for choosing indices.', {
    limit: { type: 'integer', description: 'Max items per list (default 500)' },
  }, a => {
    needEdit();
    const m = editor.model, lim = a.limit || 500, mesh = editor.mesh, p = new THREE.Vector3();
    mesh.updateMatrixWorld(true);
    const vertices = [], edges = [], faces = [];
    for (let i = 0; i < Math.min(m.nVerts, lim); i++) vertices.push(mesh.localToWorld(p.fromArray(m.verts, 3 * i)).toArray().map(r3));
    let n = 0;
    for (const e of m.edges) { if (n++ >= lim) break; edges.push([e.a, e.b]); }
    n = 0;
    m.faces.forEach((f, id) => { if (n++ < lim) faces.push({ id, vertices: [...f.vids] }); });
    return { vertices, edges, faces, truncated: m.nVerts > lim || m.faces.size > lim };
  }, { readOnly: true });

  define('select_sub_objects', 'Select vertices, edges ([a,b] vertex pairs) or faces (ids) of the current kind. Use all=true / none=true for everything / nothing.', {
    ids: { type: 'array', items: { anyOf: [{ type: 'integer' }, { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 }] } },
    all: { type: 'boolean' }, none: { type: 'boolean' }, add: { type: 'boolean', description: 'Extend the selection instead of replacing it' },
  }, a => {
    needEdit();
    const m = editor.model;
    if (!a.add || a.none || a.all) editor.clearSelection();
    if (a.all) editor.selectAll();
    else if (!a.none) {
      for (const id of a.ids || []) {
        if (editor.kind === 'vertex') { if (!(id >= 0 && id < m.nVerts)) throw new Error(`No vertex ${id}`); editor.selV.add(id); }
        else if (editor.kind === 'face') { if (!m.faces.has(id)) throw new Error(`No face ${id}`); editor.selF.add(id); }
        else {
          const key = edgeKey(id[0], id[1]);
          if (!m.edgeByKey.has(key)) throw new Error(`No edge ${id}`);
          editor.selE.add(key);
        }
      }
      editor.refreshSelection();
    }
    return selState();
  });

  define('move_selection', 'Move the selected sub-objects by a world-space offset.', { offset: vec3 }, a => {
    needEdit();
    const vids = editor.transformVids();
    if (!vids.size) throw new Error('Nothing selected');
    const mesh = editor.mesh, m = editor.model;
    mesh.updateMatrixWorld(true);
    const d = new THREE.Vector3(...a.offset).applyMatrix3(new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld).invert());
    const v = new THREE.Vector3();
    vids.forEach(i => v.fromArray(m.verts, 3 * i).add(d).toArray(m.verts, 3 * i));
    editor.changed = true;
    editor.applyVerts();
    editor.updatePivot();
    app.commit();
    return { moved: vids.size };
  }, { required: ['offset'] });

  const sub = (label, can, run) => (a = {}) => {
    needEdit();
    if (!can(a)) throw new Error(`${label}: not possible with the current selection`);
    run(a);
    app.commit();
    app.updateToolbar();
    return selState();
  };
  define('edit_extrude', 'Faces: extrude the selected faces. Edges: connect two selected points. Vertices: not supported.', {},
    sub('Extrude', () => editor.canAdd(), () => editor.add()));
  define('edit_remove', 'Remove the selected vertices / edges / faces.', {}, sub('Remove', () => editor.canRemove(), () => editor.remove()));
  define('edit_chamfer', 'Chamfer the selected edges.', { width: { ...num, description: 'default 0.2' } },
    sub('Chamfer', () => editor.canChamfer(), a => { if (!editor.chamferEdges(a.width || 0.2)) throw new Error('Chamfer failed'); }));
  define('edit_subdivide', 'Subdivide the selected faces (Catmull-Clark).', {},
    sub('Subdivide', () => editor.canSubdivide(), () => { if (!editor.subdivide()) throw new Error('Subdivide failed'); }));

  define('align_pivot', 'Move the object pivot to the single selected vertex / edge / face (position and/or orientation); the shape stays in place.', {
    position: { type: 'boolean', description: 'default true' }, rotation: { type: 'boolean', description: 'default false' },
  }, a => {
    needEdit();
    if (editor.selCount() !== 1) throw new Error('Exactly one sub-object must be selected');
    editor.alignPivotToSelection(a.position ?? true, a.rotation ?? false);
    app.commit();
    app.updateToolbar();
    return { object: describe(editor.mesh) };
  });

  // ---- Tools (object mode) ----------------------------------------
  const withSelection = (names, min) => {
    objectMode();
    if (names) app.setSelectionList(names.map(byName));
    if (app.selection().length < min) throw new Error(`Select at least ${min} object(s)`);
  };
  const objectsNow = () => ({ objects: boxes.map(m => m.userData.name), selection: app.selection().map(m => m.userData.name) });
  const namesProp = { names: { type: 'array', items: str, description: 'Objects to use (default: current selection)' } };

  define('boolean_operation', 'Boolean of exactly two objects A and B (closed meshes). The result replaces them.', {
    names: { type: 'array', items: str, minItems: 2, maxItems: 2, description: '[A, B]' }, op: { ...str, enum: ['union', 'subtract'] },
  }, a => {
    withSelection(a.names, 2);
    if (app.selection().length !== 2) throw new Error('Exactly two objects are needed');
    document.querySelector(`[name=boolOp][value=${a.op || 'union'}]`).checked = true;
    app.applyBool();
    return objectsNow();
  });

  define('merge_objects', 'Merge two or more objects into one.', { ...namesProp, union: { type: 'boolean', description: 'Boolean union instead of joining the meshes' } }, a => {
    withSelection(a.names, 2);
    document.getElementById('mergeUnion').checked = !!a.union;
    app.mergeSelected();
    return objectsNow();
  });

  define('remesh_objects', 'Rebuild the objects with evenly sized triangles.', { ...namesProp, fineness: { ...num, description: 'Edges along the longest side, 2-200 (default 10)' } }, a => {
    withSelection(a.names, 1);
    document.getElementById('rmFine').value = a.fineness || 10;
    app.applyRemesh();
    return objectsNow();
  });

  define('array_objects', 'Create copies of the objects with a repeated offset / rotation / scale per copy.', {
    ...namesProp, count: { type: 'integer', description: 'Number of copies (1-100)' }, offset: vec3, rotationDeg: vec3, scale: vec3,
    local: { type: 'boolean', description: 'Each copy rotates around its own axes' },
  }, a => {
    withSelection(a.names, 1);
    const set = (pre, v, def) => ['x', 'y', 'z'].forEach((c, i) => { document.getElementById(pre + c).value = v ? v[i] : def; });
    document.getElementById('arCount').value = a.count || 3;
    set('arP', a.offset, 1); set('arR', a.rotationDeg, 0); set('arS', a.scale, 1);
    document.getElementById('arRel').checked = !!a.local;
    app.applyArray();
    return objectsNow();
  });

  define('flip_normals', 'Flip the normals of the objects.', namesProp, a => { withSelection(a.names, 1); app.flipSelected(); return objectsNow(); });
  define('close_holes', 'Close open holes of the objects.', namesProp, a => { withSelection(a.names, 1); app.closeHoles(); return objectsNow(); });

  define('lattice_deform', 'Deform one object with a lattice cage and apply it. Control points are addressed by grid index [i,j,k] (0..divisions-1 along local x, y, z); offsets are in the object\'s local units.', {
    name: str, divisions: { type: 'integer', enum: [2, 3, 4] },
    moves: { type: 'array', items: { type: 'object', properties: { index: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 }, offset: vec3 }, required: ['index', 'offset'] } },
  }, a => {
    withSelection(a.name ? [a.name] : null, 1);
    if (app.selection().length !== 1) throw new Error('Exactly one object is needed');
    app.closeLattice();
    const n = a.divisions || 3;
    const lat = app.openLattice(n);
    for (const mv of a.moves || []) {
      const [i, j, k] = mv.index;
      if ([i, j, k].some(v => !(v >= 0 && v < n))) throw new Error(`Index out of range for ${n} divisions`);
      const o = ((i * n + j) * n + k) * 3;
      for (let c = 0; c < 3; c++) lat.P[o + c] += mv.offset[c];
    }
    app.applyLattice();
    return describe(app.selection()[0]);
  });

  // ---- Registration ------------------------------------------------
  const list = [...tools.values()];
  const mc = navigator.modelContext;
  if (mc?.registerTool) {
    for (const t of list) {
      try { mc.registerTool({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, execute: t.execute }); } catch (e) { console.warn('WebMCP:', t.name, e.message); }
    }
  }
  window.webmcp = { tools: list.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), call: (name, args) => { const t = tools.get(name); if (!t) throw new Error(`Unknown tool ${name}`); return t.execute(args); } };
  return list.length;
}
