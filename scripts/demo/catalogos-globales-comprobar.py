#!/usr/bin/env python3
# scripts/demo/catalogos-globales-comprobar.py
#
# DM1 · 2b-2 (02/11). Comprueba la semilla de catálogos globales que deja
# volcar-catalogos-globales.yml y saca SOLO números y huellas («@@ clave valor»,
# para scripts/conta/salida-segura.mjs). Sale con 1 si no tiene las 16 tablas o
# si el delimitador $catalogo$ aparece dentro de algún dato (no cargaría).
import re
import sys

texto = open(sys.argv[1], encoding='utf-8').read()
inserts = len(re.findall(r'^insert into public\.', texto, re.M))
delimitadores = texto.count('$catalogo$')
print(f'@@ tablas {inserts}')
print(f'@@ delimitadores {delimitadores}')
print(f'@@ bytes {len(texto.encode("utf-8"))}')
for tabla, filas, huella in re.findall(r'^-- ([a-z_]+): (\d+) filas · huella ([0-9a-f]+)$', texto, re.M):
    print(f'@@ {tabla} {filas}')
    print(f'@@ {tabla}_huella {huella}')
sys.exit(0 if inserts == 16 and delimitadores == 32 else 1)
