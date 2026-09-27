#!/usr/bin/env python3
"""Monta el ensayo de la migración del coste medio ponderado.

Incrusta el cuerpo de la migración (sin su «begin;» y su «commit;») en la
plantilla del ensayo, dentro del único bloque DO que acaba en RAISE: al
correrlo no queda nada escrito. Escribe el SQL montado por la salida estándar.

    python3 scripts/montar_ensayo_coste_medio.py > /tmp/ensayo.sql
"""
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MIGRACION = RAIZ / 'supabase/migrations/20260927T0100_el_coste_es_lo_que_se_compro.sql'
PLANTILLA = RAIZ / 'docs/propuestas/ensayo_el_coste_es_lo_que_se_compro.sql'
MARCA = '--@@MIGRACION@@'

cuerpo = [
    linea for linea in MIGRACION.read_text(encoding='utf-8').splitlines()
    if linea.strip().lower() not in ('begin;', 'commit;')
]
# Solo cuenta la línea que ES la marca: la cabecera la cita en un comentario.
lineas = PLANTILLA.read_text(encoding='utf-8').splitlines()
marcas = [i for i, linea in enumerate(lineas) if linea.strip() == MARCA]
if len(marcas) != 1:
    raise SystemExit(f'la plantilla debe tener exactamente una línea {MARCA}')
i = marcas[0]
print('\n'.join(lineas[:i] + cuerpo + lineas[i + 1:]))
