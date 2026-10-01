"""Export a small set of grass tufts from Poly Haven's grass_medium_01 pack.

    python tools/export_grass.py

Each tuft is moved to the origin and exported once; the viewer instances them.
"""
import os, warnings
import bpy, mathutils

warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "grass_medium_01", "grass_medium_01_1k.blend"))

# (object name, name in the glb). LOD1 for the tufts you see up close, LOD2 for the rest.
PICK = {
    "grass_medium_01_mid_b_LOD2": "mid_b",
    "grass_medium_01_mid_c_LOD2": "mid_c",
    "grass_medium_01_tall_a_LOD2": "tall_a",
    "grass_medium_01_tall_b_LOD2": "tall_b",
    "grass_medium_01_tall_c_LOD2": "tall_c",
    "grass_medium_01_small_b_LOD2": "small_b",
    "grass_medium_01_tiny_a_LOD1": "tiny_a",
    "grass_medium_01_tiny_e_LOD2": "tiny_e",
}
picked = []
for src, name in PICK.items():
    o = bpy.data.objects[src]
    pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    cx = sum(p.x for p in pts) / 8
    cy = sum(p.y for p in pts) / 8
    zmin = min(p.z for p in pts)
    me = o.data
    me.transform(mathutils.Matrix.Translation((-cx, -cy, -zmin)) @ o.matrix_world)
    o.matrix_world = mathutils.Matrix.Identity(4)
    o.name = name
    picked.append(o)

for i, o in enumerate(picked):  # lay out on a row so one glb holds them all
    o.location = (i * 2.0, 0, 0)

# single flat material; the viewer swaps in the alpha-tested one by name
mat = bpy.data.materials["grass_medium_01"]
mat.name = "VK grass"
nt = mat.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
p = nt.nodes.new("ShaderNodeBsdfPrincipled")
nt.links.new(p.outputs[0], out.inputs[0])
for o in picked:
    o.data.materials.clear()
    o.data.materials.append(mat)

bpy.ops.object.select_all(action="DESELECT")
for o in picked:
    if o.name not in bpy.context.view_layer.objects:
        bpy.context.scene.collection.objects.link(o)
    o.select_set(True)
bpy.context.view_layer.objects.active = picked[0]
dst = os.path.join(ROOT, "web", "models", "grass.glb")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_apply=True,
                          export_materials="EXPORT", export_cameras=False, export_lights=False,
                          export_draco_mesh_compression_enable=True)
print("wrote grass.glb", os.path.getsize(dst) / 1e6, "MB", {o.name: sum(len(pp.vertices) - 2 for pp in o.data.polygons) for o in picked})
