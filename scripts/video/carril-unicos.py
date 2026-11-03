#!/usr/bin/env python3
# scripts/video/carril-unicos.py — V01 · parche AL VUELO de scripts/e2e/carril/clonar.sql (solo en el runner del vídeo).
#
# Desde el 03/11 la plantilla A tiene pagos de verdad del B01 (conta_pago_salida),
# y su request_id (uuid, ÚNICO en toda la tabla y no clave primaria) se copiaba
# tal cual: el clon paraba con «duplicate key … conta_pago_salida_request_id_key»
# (run 41607275962). Igual que con las claves primarias, cada uuid de una columna
# única recibe su id del carril. No se cambia el fichero del repositorio (lo
# usan todas las e2e): esto lo apunta el parte para quien lleve el carril.
import sys

ruta = sys.argv[1]
s = open(ruta, encoding="utf-8").read()
ancla = """    execute format('insert into _k select %I, pg_temp.en_carril(%I, %s) from %I where %I is not null on conflict do nothing', c.attname, c.attname, n, c.temp, c.attname);
  end loop;
"""
extra = """  -- V01 (parche del vídeo): también los uuid de una columna ÚNICA que no es la clave (p. ej. conta_pago_salida.request_id).
  for c in
    select cx.tabla, cx.temp, a.attname from _copia cx
      join pg_index i on i.indrelid = cx.tabla and i.indisunique and not i.indisprimary and i.indnatts = 1
      join pg_attribute a on a.attrelid = cx.tabla and a.attnum = i.indkey[0] and a.atttypid = 'uuid'::regtype
  loop
    execute format('insert into _k select %I, pg_temp.en_carril(%I, %s) from %I where %I is not null on conflict do nothing', c.attname, c.attname, n, c.temp, c.attname);
  end loop;
"""
if extra in s:
    print("clonar.sql ya lleva el parche.")
elif s.count(ancla) != 1:
    sys.exit("carril-unicos.py: no encuentro dónde poner el parche en clonar.sql (¿ha cambiado?).")
else:
    open(ruta, "w", encoding="utf-8").write(s.replace(ancla, ancla + extra))
    print("clonar.sql: los uuid únicos también reciben su id del carril.")
