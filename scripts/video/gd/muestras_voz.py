#!/usr/bin/env python3
# scripts/video/gd/muestras_voz.py — GD · nº96, fase 2: la muestra de voz para que Julio elija.
#
#   python3 scripts/video/gd/muestras_voz.py <frases.json> <salida>
#
# Las mismas frases (scripts/video/gd/locucion.mjs --muestra) con las dos voces en juego, con el
# modelo que pide scripts/video/voz-elevenlabs.txt («modelo: v4»). Deja, por voz:
#   <salida>/<voz>/<id>.mp3 y <salida>/<voz>/<id>.txt (su texto al lado), y <salida>/LEEME.txt.
# No cambia voz-elevenlabs.txt ni voz_nube.py: la voz del vídeo sigue siendo la de ese fichero
# hasta que Julio elija. La clave, del secreto VOZ_ELEVENLABS_KEY (nunca en el registro).
import json
import os
import sys
import urllib.error
import urllib.request

VOCES = {"julio": "TbcXaMnSerONT83CTICz", "abel": "bsEDAkNZWaEolZ7vEeVJ"}

frases = json.load(open(sys.argv[1], encoding="utf-8"))
salida = sys.argv[2]
CLAVE = os.environ.get("VOZ_ELEVENLABS_KEY", "").strip()
if not CLAVE:
    print("::error::Falta el secreto VOZ_ELEVENLABS_KEY: sin él no hay muestra.")
    sys.exit(2)

FICHERO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "voz-elevenlabs.txt")
utiles = [l.strip() for l in open(FICHERO, encoding="utf-8") if l.strip() and not l.strip().startswith("#")]
pedido = next((l.split(":", 1)[1].strip() for l in utiles if l.lower().startswith("modelo:")), "v4")


def pedir(url, cuerpo=None):
    req = urllib.request.Request(url, data=None if cuerpo is None else json.dumps(cuerpo).encode("utf-8"),
                                 method="GET" if cuerpo is None else "POST",
                                 headers={"Content-Type": "application/json", "xi-api-key": CLAVE})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


# El modelo, como voz_nube.py: el de la lista que se llama así; sin lista, sus formas habituales.
try:
    tts = [m for m in json.loads(pedir("https://api.elevenlabs.io/v1/models")) if m.get("can_do_text_to_speech", True)]
except Exception:  # noqa: BLE001
    tts = []
q = pedido.lower().replace(" ", "")
encontrados = [m["model_id"] for m in tts if m.get("model_id", "").lower() == q or q in m.get("model_id", "").lower().replace("_", "") or q in str(m.get("name", "")).lower().replace(" ", "")]
v = q.replace("eleven", "").lstrip("_")
candidatos = encontrados[:1] or [f"eleven_{v}", f"eleven_{v}_alpha", f"eleven_{v}_preview", pedido]

modelo = None
for voz_id in [VOCES["abel"]]:
    for m in candidatos:
        try:
            pedir(f"https://api.elevenlabs.io/v1/text-to-speech/{voz_id}?output_format=mp3_44100_128", {"text": "Hola.", "model_id": m})
            modelo = m
            break
        except urllib.error.HTTPError as e:
            if e.code in (400, 404, 422):
                continue
            sys.exit(f"ElevenLabs: HTTP {e.code}")
if not modelo:
    sys.exit(f"ElevenLabs: ningún modelo «{pedido}» ({', '.join(candidatos)}).")
print(f"Modelo: {modelo}")

for nombre, voz_id in VOCES.items():
    d = os.path.join(salida, nombre)
    os.makedirs(d, exist_ok=True)
    for i, f in enumerate(frases):
        cuerpo = {"text": f["texto"], "model_id": modelo, "language_code": "es"}
        if i > 0:
            cuerpo["previous_text"] = frases[i - 1]["texto"]
        if i + 1 < len(frases):
            cuerpo["next_text"] = frases[i + 1]["texto"]
        mp3 = None
        for quitar in ([], ["previous_text", "next_text"], ["previous_text", "next_text", "language_code"]):
            for k in quitar:
                cuerpo.pop(k, None)
            try:
                mp3 = pedir(f"https://api.elevenlabs.io/v1/text-to-speech/{voz_id}?output_format=mp3_44100_128", cuerpo)
                break
            except urllib.error.HTTPError as e:
                if e.code not in (400, 422):
                    sys.exit(f"ElevenLabs ({nombre}): HTTP {e.code}")
        if mp3 is None:
            sys.exit(f"ElevenLabs ({nombre}): la frase {f['id']} no ha salido.")
        open(os.path.join(d, f"{f['id']}.mp3"), "wb").write(mp3)
        open(os.path.join(d, f"{f['id']}.txt"), "w", encoding="utf-8").write(f["texto"] + "\n")
        print(f"{nombre} · {f['id']} · {len(mp3) // 1024} KB")

open(os.path.join(salida, "LEEME.txt"), "w", encoding="utf-8").write(
    "Muestra de voz del vídeo de Sumied para gestorías (nº96, fase 2).\n"
    f"Las mismas {len(frases)} frases con las dos voces, modelo {modelo} de ElevenLabs:\n"
    f"  julio/  Julio Clon ({VOCES['julio']})\n  abel/   Abel ({VOCES['abel']}), la de voz-elevenlabs.txt\n"
    "Cada .mp3 lleva su texto al lado (.txt).\n")
