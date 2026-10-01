"""Export Varstakatu_2.blend to web-ready glTF.

Run with the bpy module (pip install bpy==5.0.1) from the repo root:
    python tools/export_scene.py

Writes:
  web/models/house.glb    house, yard, interior, shrubs
  web/models/terrain.glb  terrain, field, roads (terrain splat masks in COLOR_0)
  web/models/birch.glb    the three birch variants (instanced in the viewer)
  web/data/scene.json     tree positions, species sizes, cameras, sun
Materials are exported as flat placeholders; the viewer rebuilds the real ones by name.
"""
import json, math, os, sys, warnings
import bpy, mathutils

warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MODELS = os.path.join(ROOT, "web", "models")
OUT_DATA = os.path.join(ROOT, "web", "data")
os.makedirs(OUT_MODELS, exist_ok=True)
os.makedirs(OUT_DATA, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "Varstakatu_2.blend"))
scene = bpy.context.scene

# Materials whose look is rebuilt in the viewer from a texture set or procedural recipe.
# They are flattened to their average colour here so the exporter never sees node graphs.
KEEP_NODES = {"VK hortensian kukat", "VK hortensian lehdet", "VK koivun lehdet", "VK pensaan lehdet"}

TERRAIN_OBJECTS = ["Maasto", "Pelto", "Linnunrata - ajorata", "Linnunrata - pyörätie", "Varstakatu"]
SKIP_COLLECTIONS = {"Huonenimet", "Kamerat ja valo", "Suunnittelu", "Puusto",
                    "Puut kauempana (laserkeilaus)", "Puut lähellä (laserkeilaus)", "Koivut"}
SKIP_NAMES = {"Cube.005"}  # unused pine trunk helper
BIRCHES = ["VK koivu a", "VK koivu b", "VK koivu c"]


def in_skipped_collection(o):
    return any(c.name in SKIP_COLLECTIONS or c.name.startswith("VK ") for c in o.users_collection)


def principled(m):
    return next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.node_tree else None


def flatten_material(m):
    """Replace node graph with a plain Principled BSDF using the shader's default values."""
    b = principled(m)
    base = tuple(b.inputs["Base Color"].default_value) if b else tuple(m.diffuse_color)
    rough = b.inputs["Roughness"].default_value if b else 0.5
    metal = b.inputs["Metallic"].default_value if b else 0.0
    alpha = b.inputs["Alpha"].default_value if b else 1.0
    # average colour of the procedural brick / board / tile nodes if the default is plain grey
    for n in (m.node_tree.nodes if m.node_tree else []):
        if n.type == "RGB":
            base = tuple(n.outputs[0].default_value)
        if n.type == "TEX_BRICK":
            c1 = n.inputs["Color1"].default_value
            c2 = n.inputs["Color2"].default_value
            base = tuple((c1[i] + c2[i]) / 2 for i in range(4))
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = base
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["Alpha"].default_value = alpha
    nt.links.new(p.outputs[0], out.inputs[0])
    if alpha < 1.0:
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None


for m in bpy.data.materials:
    if m.name.startswith(("pine_tree", "fir_tree")) or m.name in KEEP_NODES:
        continue
    if m.users:
        flatten_material(m)

# --- terrain splat masks -> COLOR_0 (R=forest, G=rock, B=dry) -------------------------
maasto = bpy.data.objects["Maasto"]
me = maasto.data
for name in list(me.color_attributes.keys()):
    me.color_attributes.remove(me.color_attributes[name])
mask = me.color_attributes.new("mask", "FLOAT_COLOR", "POINT")
f = [d.value for d in me.attributes["forest"].data]
r = [d.value for d in me.attributes["rock"].data]
dr = [d.value for d in me.attributes["dry"].data]
for i, d in enumerate(mask.data):
    d.color = (f[i], r[i], dr[i], 1.0)
me.color_attributes.active_color = mask
me.color_attributes.render_color_index = me.color_attributes.find("mask")


def select(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export(objs, filename, vertex_colors=False):
    select(objs)
    kw = dict(
        filepath=os.path.join(OUT_MODELS, filename),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="WEBP",
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_texcoords=True,
        export_normals=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
        export_draco_color_quantization=8,
        export_vertex_color="ACTIVE" if vertex_colors else "NONE",
        export_active_vertex_color_when_no_material=vertex_colors,
    )
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:  # property names differ between Blender versions
        print("exporter rejected option:", e)
        for k in ("export_vertex_color", "export_active_vertex_color_when_no_material"):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)
    size = os.path.getsize(os.path.join(OUT_MODELS, filename)) / 1e6
    print(f"wrote {filename}: {len(objs)} objects, {size:.2f} MB")


terrain = [bpy.data.objects[n] for n in TERRAIN_OBJECTS]
house = [o for o in bpy.data.objects
         if o.type == "MESH" and o.name not in TERRAIN_OBJECTS and o.name not in SKIP_NAMES
         and not o.name.startswith(("VK ", "pine_", "fir_")) and not in_skipped_collection(o)
         and o.name != "Plane"]
print("house objects:", [o.name for o in house])
export(house, "house.glb")
export(terrain, "terrain.glb", vertex_colors=True)

# --- birches: move each variant to the origin and export once ------------------------
birch_objs = []
for n in BIRCHES:
    o = bpy.data.objects[n]
    if o.name not in bpy.context.view_layer.objects:  # their collections are excluded from the view layer
        scene.collection.objects.link(o)
    o.location = (0, 0, 0)
    birch_objs.append(o)
for i, o in enumerate(birch_objs):  # lay them out side by side, the viewer splits by name
    o.location = (i * 10.0, 0, 0)
export(birch_objs, "birch.glb")

# --- scene data ----------------------------------------------------------------------
def species_of(coll_name):
    n = coll_name.lower()
    kind = "birch" if "koivu" in n else "fir" if "fir" in n else "pine"
    lod = "near" if "lähi" in n else "mid" if "etä" in n and "kauko" not in n else "far"
    variant = n.split()[2] if kind != "birch" else n.split()[-1]
    return kind, lod, variant


def height_of(coll):
    zs = []
    for o in coll.all_objects:
        if o.type == "MESH":
            pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
            zs += [p.z for p in pts]
    return (max(zs) - min(zs)) if zs else None

trees = []
heights = {}
for c in ("Puut lähellä (laserkeilaus)", "Puut kauempana (laserkeilaus)", "Koivut"):
    for o in bpy.data.collections[c].objects:
        if o.type != "EMPTY" or not o.instance_collection:
            continue
        kind, lod, variant = species_of(o.instance_collection.name)
        cn = o.instance_collection.name
        if cn not in heights:
            heights[cn] = height_of(o.instance_collection)
        trees.append({
            "p": [round(o.location.x, 2), round(o.location.z, 2), round(-o.location.y, 2)],
            "s": round(o.scale.z, 3), "r": round(o.rotation_euler.z, 3),
            "k": kind, "l": lod, "v": variant, "g": c.startswith("Koivut"),
        })

cams = []
for o in bpy.data.objects:
    if o.type == "CAMERA":
        fwd = o.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))
        tgt = o.location + fwd * 25
        cams.append({"name": o.name, "p": [round(o.location.x, 2), round(o.location.z, 2), round(-o.location.y, 2)],
                     "t": [round(tgt.x, 2), round(tgt.z, 2), round(-tgt.y, 2)],
                     "fov": round(math.degrees(2 * math.atan(o.data.sensor_width / 2 / o.data.lens)), 1),
                     "rot": [round(v, 4) for v in o.rotation_euler]})
sun = bpy.data.objects["Aurinko"]
data = {"trees": trees, "heights": heights, "cameras": cams,
        "sun": {"rot": [round(v, 4) for v in sun.rotation_euler], "strength": sun.data.energy}}
with open(os.path.join(OUT_DATA, "scene.json"), "w") as fh:
    json.dump(data, fh, separators=(",", ":"))
print("trees:", len(trees), "heights:", {k: (round(v, 1) if v else None) for k, v in heights.items()})
