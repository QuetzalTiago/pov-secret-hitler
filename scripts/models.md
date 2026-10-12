# Reproducing `client/models/`

Raw downloads go in `C:\Users\Tiago\code\pov-assets-src\` (outside git). Optimised outputs are committed. Never use `draco` or `meshopt` (the site CSP forbids WebAssembly decoders). `KHR_mesh_quantization` and `EXT_texture_webp` are fine. Run gltf-transform from outside the repo (it is fetched with `npx -y`, nothing is installed):

```sh
G="npx -y @gltf-transform/cli@4"
SRC=/c/Users/Tiago/code/pov-assets-src      # raw files
OUT=client/models
```

Details and licenses: `docs/spikes/models-2026-10.md`, credits: `client/models/CREDITS.md`.

## Characters (poly.pizza, Quaternius, CC0)

Page URL lists the model; the GLB lives on `static.poly.pizza`.

| Name | Page | GLB |
|---|---|---|
| ManInSuit | https://poly.pizza/m/mQnGoME1ez | https://static.poly.pizza/66b57880-bcb0-479a-8d72-5c3e88afaa39.glb |
| Man | https://poly.pizza/m/HMnuH5geEG | https://static.poly.pizza/3746be88-6799-4817-929b-6bc067c47caa.glb |
| WomanInDress | https://poly.pizza/m/zMyPlQXBzq | https://static.poly.pizza/a642af96-e239-4c5f-b50d-7661ff51deec.glb |
| WomanCasual | https://poly.pizza/m/jpKRgGDxhk | https://static.poly.pizza/51d5abdd-bb87-4b8d-9967-21738ffb8437.glb |
| WomanTankTop | https://poly.pizza/m/XqzeZGB7iU | https://static.poly.pizza/9a6a3e55-23ce-4d5c-89bc-7d3f30307ed0.glb |

```sh
curl -sL https://static.poly.pizza/66b57880-bcb0-479a-8d72-5c3e88afaa39.glb -o $SRC/chars/ManInSuit.glb
curl -sL https://static.poly.pizza/3746be88-6799-4817-929b-6bc067c47caa.glb -o $SRC/chars/Man.glb
curl -sL https://static.poly.pizza/a642af96-e239-4c5f-b50d-7661ff51deec.glb -o $SRC/chars/WomanInDress.glb
curl -sL https://static.poly.pizza/51d5abdd-bb87-4b8d-9967-21738ffb8437.glb -o $SRC/chars/WomanCasual.glb
curl -sL https://static.poly.pizza/9a6a3e55-23ce-4d5c-89bc-7d3f30307ed0.glb -o $SRC/chars/WomanTankTop.glb

# per character: <raw name> -> <output name>
opt_char() {
  $G prune  $SRC/chars/$1.glb /tmp/a.glb
  $G dedup  /tmp/a.glb /tmp/b.glb
  $G weld   /tmp/b.glb /tmp/c.glb
  $G resample /tmp/c.glb /tmp/d.glb
  $G quantize /tmp/d.glb $OUT/chars/$2.glb
}
opt_char ManInSuit    man_suit
opt_char Man          man_casual
opt_char WomanInDress woman_dress
opt_char WomanCasual  woman_casual   # outfit 'blouse'; needs dedup --materials false (Eyes and Shoes share a colour and would merge)
opt_char WomanTankTop woman_tank
```

Check afterwards that the skin (31 joints) and 11 animations survived: `$G inspect $OUT/chars/man_suit.glb`.

## Props from Poly Haven (CC0)

The API gives the file list: `https://api.polyhaven.com/files/<id>` (use `.gltf["1k"].gltf`: the `.gltf` url plus every file under `include`, saved at the relative path shown). Models used: `painted_wooden_chair_01`, `painted_wooden_stool`, `hanging_industrial_lamp`. Save each into `$SRC/props/<id>/`.

```sh
PH=$SRC/props
opt_prop() {  # <src file> <output name> [simplify ratio]
  $G prune $1 /tmp/p1.glb && $G dedup /tmp/p1.glb /tmp/p2.glb && $G weld /tmp/p2.glb /tmp/p3.glb
  cur=/tmp/p3.glb
  if [ -n "$3" ]; then $G simplify $cur /tmp/p4.glb --ratio $3 --error 0.02; cur=/tmp/p4.glb; fi
  $G resize $cur /tmp/p5.glb --width 512 --height 512
  $G webp /tmp/p5.glb /tmp/p6.glb --quality 80
  $G quantize /tmp/p6.glb $OUT/props/$2.glb
  $G prune $OUT/props/$2.glb $OUT/props/$2.glb
}
opt_prop $PH/painted_wooden_chair_01/painted_wooden_chair_01_1k.gltf chair_wood
opt_prop $PH/painted_wooden_stool/painted_wooden_stool_1k.gltf stool_wood
opt_prop $PH/hanging_industrial_lamp/hanging_industrial_lamp_1k.gltf lamp_pendant 0.3
```

## Props from poly.pizza (CC0)

| Output | Page | GLB |
|---|---|---|
| bottle_old | https://poly.pizza/m/NxbygmpVwR | https://static.poly.pizza/2da3d98d-b72f-4934-8816-7000297115f6.glb |
| bottle_a | https://poly.pizza/m/FAHsHFXfTf | https://static.poly.pizza/73811091-d5cf-4970-b635-a496ccde614e.glb |
| bottle_b | https://poly.pizza/m/Pc8dM9Ja4V | https://static.poly.pizza/a441a76e-cc50-48a7-bc0a-430a5e242ef9.glb |
| bottle_wine | https://poly.pizza/m/NvGUg8c03o | https://static.poly.pizza/0df83eb7-c2bb-4261-876c-7d621ab2e099.glb |
| glass_vodka | https://poly.pizza/m/aMVC0Yj7UK | https://static.poly.pizza/bc01a4f8-c98f-4dda-89db-7b7aed66867e.glb |
| glass_cognac | https://poly.pizza/m/RHMny72Uxd | https://static.poly.pizza/e9b6b48f-86d6-4269-b827-f81f33bb0770.glb |
| glass_wine | https://poly.pizza/m/laPUjurMUD | https://static.poly.pizza/58ec2c22-a323-410f-92f5-0952ea8c3d98.glb |

```sh
# download each to $SRC/props/<output>.glb with curl -sL <GLB url> -o ..., then:
for n in bottle_old bottle_a bottle_b bottle_wine glass_vodka glass_cognac glass_wine; do
  opt_prop $SRC/props/$n.glb $n
done
```

## Textures (Poly Haven, 1k jpg to WebP)

Poly Haven API `https://api.polyhaven.com/files/<id>`: keys `Diffuse`, `nor_gl`, `Rough`, each `["1k"].jpg.url`. Ids: `dark_wooden_planks` (floor_planks), `yellow_plaster` (wall_plaster), `dark_wood` (counter_wood). Save to `$SRC/tex/<id>/<id>_{diff,nor_gl,rough}_1k.jpg`, then (needs ffmpeg with libwebp):

```sh
conv() { ffmpeg -v error -y -i $SRC/tex/$1/$1_$3_1k.jpg -vf scale=1024:1024 -c:v libwebp -quality $4 $OUT/tex/$2_$5.webp; }
for pair in dark_wooden_planks:floor_planks yellow_plaster:wall_plaster dark_wood:counter_wood; do
  id=${pair%%:*}; nm=${pair##*:}
  conv $id $nm diff 72 diff
  conv $id $nm nor_gl 72 nor
  conv $id $nm rough 60 rough
done
```

## HDRI (Poly Haven, 1k)

```sh
curl -sL "$(curl -s https://api.polyhaven.com/files/warm_bar | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).hdri["1k"].hdr.url))')" -o $OUT/env/warm_bar_1k.hdr
```

Copied unchanged (1,487,340 bytes, under the 1.6 MB limit).

## Not downloadable by script

The full Quaternius "Ultimate Animated Character Pack" is on Google Drive, which returned "Quota exceeded" for scripted downloads. See "Needs a human download" in `docs/spikes/models-2026-10.md`.
