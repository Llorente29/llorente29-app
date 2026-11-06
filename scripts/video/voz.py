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

# Un poco más pausada que la de serie: es un vídeo comercial, no un aviso.
LENTITUD = 1.12

modelo, ruta = sys.argv[1], sys.argv[2]
voz = PiperVoice.load(modelo)
frases = json.load(open(ruta, encoding="utf-8"))
for f in frases:
    with wave.open(f["salida"], "wb") as w:
        if hasattr(voz, "synthesize_wav"):
            try:
                from piper import SynthesisConfig
                voz.synthesize_wav(f["texto"], w, syn_config=SynthesisConfig(length_scale=LENTITUD))
            except ImportError:
                voz.synthesize_wav(f["texto"], w)
        else:
            voz.synthesize(f["texto"], w, length_scale=LENTITUD)
    with wave.open(f["salida"], "rb") as r:
        f["dura"] = r.getnframes() / float(r.getframerate())
    print(f"{f['dura']:5.2f} s · {f['texto']}")
json.dump(frases, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
