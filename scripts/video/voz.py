#!/usr/bin/env python3
# scripts/video/voz.py — V01 · la voz del vídeo, con Piper (voz neuronal libre, local).
#
#   python3 scripts/video/voz.py <modelo.onnx> <frases.json>
#
# frases.json: [{"texto": "...", "salida": "ruta.wav"}, ...]. Escribe cada WAV
# y deja en frases.json su duración en segundos ("dura"). Sin red: el modelo
# ya está en el disco (lo baja el workflow).
import json
import sys
import wave

from piper import PiperVoice

modelo, ruta = sys.argv[1], sys.argv[2]
voz = PiperVoice.load(modelo)
frases = json.load(open(ruta, encoding="utf-8"))
for f in frases:
    with wave.open(f["salida"], "wb") as w:
        if hasattr(voz, "synthesize_wav"):
            voz.synthesize_wav(f["texto"], w)
        else:
            voz.synthesize(f["texto"], w)
    with wave.open(f["salida"], "rb") as r:
        f["dura"] = r.getnframes() / float(r.getframerate())
    print(f"{f['dura']:5.2f} s · {f['texto']}")
json.dump(frases, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
