-- scripts/conta/staging/agentes-volcar.sql
--
-- DM1·4 (03/11) · Para las pruebas de staging: vuelca los dos agentes de
-- solo lectura de agentes.sh («Datos maestros e impuestos», con Terceros, y
-- «Libro diario») a /tmp, DENTRO de la transacción de la prueba (ven lo que la
-- prueba acaba de sembrar). Lo juzga scripts/conta/staging/agentes-rojos.sh.
\pset format unaligned
\pset tuples_only on
\o /tmp/prueba-agente-datos.json
\i scripts/conta/agente-datos-maestros.sql
\o /tmp/prueba-agente-terceros.json
\i scripts/conta/agente-terceros.sql
\o /tmp/prueba-agente-libro.json
\i scripts/conta/agente-libro.sql
\o
\pset format aligned
\pset tuples_only off
