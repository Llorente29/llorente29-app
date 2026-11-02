#!/usr/bin/env python3
# scripts/demo/catalogos-globales-causa.py
#
# DM1 · 2b-2 (02/11). Si el volcado de los catálogos globales falla, dice POR
# QUÉ sin enseñar datos: lee el fichero de errores de psql y saca solo claves
# fijas («@@ clave 1», para scripts/conta/salida-segura.mjs):
#   · permiso_denegado.<tabla>  si a conta_lectura le falta SELECT en una de las
#                               tablas o vistas que lee (solo nombres de esta lista);
#   · no_es_catalogo            si paró la guarda (un curso o un itinerario global
#                               apunta a algo de una cuenta);
#   · otro_error                cualquier otra cosa (se mira a mano).
# El 02/11 el primer volcado falló sin decir nada: era el permiso, en las 16.
import re
import sys

LEE = {
    'allergen', 'appcc_plans', 'billing_plans', 'catalogo_curso_global', 'course',
    'dish_family_template', 'ingredient_family_template', 'ingredient_template',
    'ingredient_template_allergen', 'kitchen_cut_type_template', 'kitchen_unit',
    'modules', 'shop_cuisine', 'submodules', 'tag_template', 'training_path',
    'training_path_item',
}

texto = open(sys.argv[1], encoding='utf-8', errors='replace').read()
vistas = set()
for nombre in re.findall(r'permission denied for (?:table|view|relation) ([a-z_]+)', texto):
    if nombre in LEE:
        vistas.add(nombre)
for nombre in sorted(vistas):
    print(f'@@ permiso_denegado.{nombre} 1')
guarda = 'no es un catálogo' in texto
if guarda:
    print('@@ no_es_catalogo 1')
if not vistas and not guarda and texto.strip():
    print('@@ otro_error 1')
