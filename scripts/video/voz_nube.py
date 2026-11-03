#!/usr/bin/env python3
# scripts/video/voz_nube.py — V01 · la voz con un servicio de pago (más humana que Piper).
#
#   python3 scripts/video/voz_nube.py <frases.json>
#
# Usa el primero que tenga su clave en el entorno (secretos del repositorio,
# nunca en el código ni en el registro):
#   VOZ_ELEVENLABS_KEY  (+ VOZ_ELEVENLABS_ID: el id de la voz elegida en su biblioteca)
#   VOZ_GOOGLE_KEY      (+ VOZ_GOOGLE_NOMBRE: p. ej. es-ES-Chirp3-HD-Charon)
# Si no hay ninguna, sale con código 3 y el workflow usa Piper (voz.py).
#
# Como voz.py: escribe cada WAV y deja en frases.json su duración ("dura").
# A ElevenLabs se le pasan la frase de antes y la de después (previous_text /
# next_text) para que la entonación encadene como una sola locución.
import base64
import json
import os
import sys
import urllib.request
import wave

ruta = sys.argv[1]
frases = json.load(open(ruta, encoding="utf-8"))
ELEVEN = os.environ.get("VOZ_ELEVENLABS_KEY", "").strip()
GOOGLE = os.environ.get("VOZ_GOOGLE_KEY", "").strip()


def pedir(url, cuerpo, cabeceras):
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", **cabeceras})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def wav_pcm(salida, pcm, hz):
    with wave.open(salida, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(hz)
        w.writeframes(pcm)


if ELEVEN:
    voz = os.environ.get("VOZ_ELEVENLABS_ID", "").strip()
    # scripts/video/voz-elevenlabs.txt, si lleva un id, manda sobre la variable (la voz queda escrita en el repositorio).
    fichero = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voz-elevenlabs.txt")
    if os.path.exists(fichero):
        ids = [l.strip() for l in open(fichero, encoding="utf-8") if l.strip() and not l.lstrip().startswith("#")]
        if ids:
            voz = ids[0]
    if not voz:
        sys.exit("Falta VOZ_ELEVENLABS_ID: el id de la voz de ElevenLabs.")
    # El MODELO (03/11: Julio probó la voz con «V4» en la web; Multilingual v2 suena distinto). Se pregunta a
    # ElevenLabs qué modelos hay (GET /v1/models) y se elige el que diga voz-elevenlabs.txt («modelo: v4»), o
    # VOZ_ELEVENLABS_MODELO; si no se encuentra, Multilingual v2. La lista queda en voz/modelos.txt.
    pedido = os.environ.get("VOZ_ELEVENLABS_MODELO", "").strip()
    if os.path.exists(fichero):
        for l in open(fichero, encoding="utf-8"):
            if l.strip().lower().startswith("modelo:"):
                pedido = l.split(":", 1)[1].strip()
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
            modelo = pedido
        else:
            print(f"::warning::No hay ningún modelo «{pedido}» en ElevenLabs; se usa {modelo}. Los que hay: {[m.get('model_id') for m in tts]}")
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
elif GOOGLE:
    nombre = os.environ.get("VOZ_GOOGLE_NOMBRE", "").strip() or "es-ES-Chirp3-HD-Charon"
    print(f"Voz: Google · {nombre}")
    for f in frases:
        try:
            r = json.loads(pedir(f"https://texttospeech.googleapis.com/v1/text:synthesize?key={GOOGLE}", {
                "input": {"text": f["texto"]},
                "voice": {"languageCode": "es-ES", "name": nombre},
                "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": 24000},
            }, {}))
        except urllib.error.HTTPError as e:
            sys.exit(f"Google: HTTP {e.code} {e.read()[:300]!r}")
        audio = base64.b64decode(r["audioContent"])
        # LINEAR16 de Google trae su cabecera WAV: se guarda tal cual.
        open(f["salida"], "wb").write(audio)
else:
    print("Sin clave de ElevenLabs ni de Google: se usa Piper.")
    sys.exit(3)

for f in frases:
    with wave.open(f["salida"], "rb") as r:
        f["dura"] = r.getnframes() / float(r.getframerate())
    print(f"{f['dura']:5.2f} s · {f['texto']}")
json.dump(frases, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# Con qué voz se ha hecho (sin la clave): para saberlo sin abrir el registro del run.
open(os.path.join(os.path.dirname(ruta), "proveedor.txt"), "w", encoding="utf-8").write(
    f"ElevenLabs · voz {voz} · {modelo}\n" if ELEVEN
    else f"Google · {os.environ.get('VOZ_GOOGLE_NOMBRE', '').strip() or 'es-ES-Chirp3-HD-Charon'}\n")
