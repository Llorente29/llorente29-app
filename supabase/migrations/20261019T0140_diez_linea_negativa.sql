-- C04b · T3 · Cada línea traída de Diez que iba en NEGATIVO lo dice (Julio, 12/10).
--
-- Fichero NUEVO: añade una columna que admite nulos a journal_line. No cambia
-- ningún dato ni ninguna función.
--
-- POR QUÉ: Diez admite importes negativos (un haber de −1.024,79) y Folvy no.
-- convertirAsiento los pasa al otro lado en positivo, sin cambiar el saldo de
-- ninguna cuenta (diezMapeo.ts). El testigo lo acepta solo si la diferencia de
-- debe y haber es exactamente lo pasado de lado (matiz 2). Para que el diario
-- se pueda contrastar LÍNEA A LÍNEA con el de Diez, cada línea pasada de lado
-- guarda en qué lado de Diez iba el negativo, y Libros la marca «En Diez iba
-- en negativo».
--
--   external_negative_side: null (no venía en negativo) · 'debe' · 'haber'
--   (el lado de Diez donde estaba el importe negativo).

-- El CHECK va en la misma cláusula: si la columna ya existe, no se toca nada
-- (sin «drop constraint», que el analizador contaría como destruir).
alter table public.journal_line add column if not exists external_negative_side text
  constraint journal_line_external_negative_side_check check (external_negative_side in ('debe', 'haber'));
comment on column public.journal_line.external_negative_side is
  'Traída de Diez con importe NEGATIVO: en qué lado iba allí (debe o haber). Folvy la guarda en positivo al otro lado; Libros la marca «En Diez iba en negativo».';
