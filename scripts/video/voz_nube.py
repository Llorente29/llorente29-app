#!/usr/bin/env python3
# scripts/video/voz_nube.py — V01 · la voz con un servicio de pago (más humana que Piper).
#
#   python3 scripts/video/voz_nube.py <frases.json>
#
# La voz sale SOLO de scripts/video/voz-elevenlabs.txt (su id y «modelo: v4»): ninguna
# variable del repositorio la cambia (Julio, 03/11). La clave, del secreto
# VOZ_ELEVENLABS_KEY (nunca en el código ni en el registro). Sin la clave, para en
# rojo (código 2). Solo si el fichero pide «piper: sí» sale con código 3 y el
# workflow usa Piper (voz.py): una prueba hecha a mano, nunca por defecto.
#
# Como voz.py: escribe cada WAV y deja en frases.json su duración ("dura").
# A ElevenLabs se le pasan la frase de antes y la de después (previous_text /
# next_text) para que la entonación encadene como una sola locución.
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import wave

ruta = sys.argv[1]
frases = json.load(open(ruta, encoding="utf-8"))
ELEVEN = os.environ.get("VOZ_ELEVENLABS_KEY", "").strip()


def pedir(url, cuerpo, cabeceras):
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", **cabeceras})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


FICHERO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voz-elevenlabs.txt")
lineas = [l.strip() for l in open(FICHERO, encoding="utf-8")] if os.path.exists(FICHERO) else []
utiles = [l for l in lineas if l and not l.startswith("#")]
if any(l.lower().replace(" ", "") in ("piper:sí", "piper:si") for l in utiles):
    print("voz-elevenlabs.txt pide «piper: sí»: se usa Piper (prueba hecha a mano).")
    sys.exit(3)
voz = next((l for l in utiles if ":" not in l), "")
pedido = next((l.split(":", 1)[1].strip() for l in utiles if l.lower().startswith("modelo:")), "")
if not voz:
    sys.exit("scripts/video/voz-elevenlabs.txt no lleva el id de la voz: el vídeo no se graba sin su voz.")
if not ELEVEN:
    print("::error::Falta el secreto VOZ_ELEVENLABS_KEY (GitHub › Settings › Secrets and variables › Actions). "
          "Sin él no hay voz de ElevenLabs y el vídeo no se graba con otra.")
    sys.exit(2)
modelos = []
try:
    req = urllib.request.Request("https://api.elevenlabs.io/v1/models", headers={"xi-api-key": ELEVEN})
    with urllib.request.urlopen(req, timeout=60) as r:
        modelos = json.loads(r.read())
except Exception as e:  # noqa: BLE001 — sin la lista, se usa lo pedido tal cual
    print(f"No se ha podido leer la lista de modelos: {e}")
tts = [m for m in modelos if m.get("can_do_text_to_speech", True)]
open(os.path.join(os.path.dirname(ruta), "modelos.txt"), "w", encoding="utf-8").write(
    "".join(f"{m.get('model_id')} · {m.get('name')}\n" for m in tts))
modelo = "eleven_multilingual_v2"
if pedido:
    q = pedido.lower().replace(" ", "")
    exacto = [m for m in tts if m.get("model_id", "").lower() == q]
    parecido = [m for m in tts if q in m.get("model_id", "").lower().replace("_", "") or q in str(m.get("name", "")).lower().replace(" ", "")]
    if exacto or parecido:
        modelo = (exacto or parecido)[0]["model_id"]
    elif not tts:
        # Sin la lista (la clave solo tiene «Texto a voz»: 401): candidatos por su forma habitual.
        modelo = pedido
    else:
        print(f"::warning::No hay ningún modelo «{pedido}» en ElevenLabs; se usa {modelo}. Los que hay: {[m.get('model_id') for m in tts]}")
candidatos = [modelo]
if not tts and pedido and not pedido.startswith("eleven_"):
    v = pedido.lower().replace(" ", "").replace("eleven", "").lstrip("_")
    candidatos = [f"eleven_{v}", f"eleven_{v}_alpha", f"eleven_{v}_preview", f"eleven_{v}_beta", pedido]

def probar(m):
    """¿Existe el modelo? Una frase corta: model_not_found → no."""
    try:
        pedir(f"https://api.elevenlabs.io/v1/text-to-speech/{voz}?output_format=mp3_44100_128", {"text": "Hola.", "model_id": m}, {"xi-api-key": ELEVEN})
        return True
    except urllib.error.HTTPError as e:
        cuerpo_error = e.read()[:300]
        if b"model_not_found" in cuerpo_error or b"model" in cuerpo_error and e.code in (400, 404, 422):
            print(f"  {m}: no existe ({e.code})")
            return False
        sys.exit(f"ElevenLabs ({m}): HTTP {e.code} {cuerpo_error!r}")
if len(candidatos) > 1:
    bueno = next((m for m in candidatos if probar(m)), None)
    if not bueno:
        sys.exit(f"ElevenLabs: ningún modelo «{pedido}» ({', '.join(candidatos)}). Pon el identificador exacto en voz-elevenlabs.txt, o dale a la clave el permiso de leer los modelos.")
    modelo = bueno
print(f"Voz: ElevenLabs · {modelo}")
# 03/11 (Julio: «suena a lata»): MP3 a 44,1 kHz, el de la web (el PCM a 44,1 kHz es solo de Pro, y
# el de 24 kHz perdía los agudos), y SIN voice_settings: los de la propia voz, como en su prueba.
import subprocess
for i, f in enumerate(frases):
    cuerpo = {"text": f["texto"], "model_id": modelo, "language_code": "es"}
    if i > 0 and frases[i - 1]["id"] not in ("portada",):
        cuerpo["previous_text"] = frases[i - 1]["texto"]
    if i + 1 < len(frases) and frases[i + 1]["id"] not in ("cierre",):
        cuerpo["next_text"] = frases[i + 1]["texto"]
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voz}?output_format=mp3_44100_128"
    mp3 = None
    for quitar in ([], ["previous_text", "next_text"], ["previous_text", "next_text", "language_code"]):
        for k in quitar:
            cuerpo.pop(k, None)
        try:
            mp3 = pedir(url, cuerpo, {"xi-api-key": ELEVEN})
            break
        except urllib.error.HTTPError as e:
            ultimo = f"HTTP {e.code} {e.read()[:300]!r}"
            if e.code not in (400, 422):
                sys.exit(f"ElevenLabs: {ultimo}")
    if mp3 is None:
        sys.exit(f"ElevenLabs ({modelo}): {ultimo}")
    tmp = f["salida"] + ".mp3"
    open(tmp, "wb").write(mp3)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", tmp, "-ar", "44100", "-ac", "1", f["salida"]], check=True)
    os.remove(tmp)
for f in frases:
    with wave.open(f["salida"], "rb") as r:
        f["dura"] = r.getnframes() / float(r.getframerate())
    print(f"{f['dura']:5.2f} s · {f['texto']}")
json.dump(frases, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# Con qué voz se ha hecho (sin la clave): para saberlo sin abrir el registro del run.
open(os.path.join(os.path.dirname(ruta), "proveedor.txt"), "w", encoding="utf-8").write(
    f"ElevenLabs · voz {voz} · {modelo}\n")
