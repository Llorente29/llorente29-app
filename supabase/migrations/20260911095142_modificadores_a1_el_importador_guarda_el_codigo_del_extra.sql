-- ═══════════════════════════════════════════════════════════════════════════
-- MODIFICADORES · A1 — el importador guarda el código del extra
--
-- EL FALLO, medido el 11/09 (§2.1 del RECON):
--
-- `lastapp-catalog-import` guarda en `modifier_option.external_id` el valor
-- `om.id`, que es el id del HUECO del extra dentro de una pregunta. Los pedidos
-- de Last no traen eso: traen `organizationModifierId`, que es `om.modifierId`,
-- el id DEL EXTRA — uno solo, compartido entre preguntas y entre marcas.
--
-- Son dos espacios de códigos distintos, y se nota:
--   · de las 53 referencias que traían los pedidos cedidos en 30 días, sólo 2
--     coincidían con algún `external_id` guardado;
--   · al revés, 210 opciones `lastapp` tienen 210 códigos distintos para sólo
--     126 nombres. 56 nombres llevan más de un código; el peor, nueve.
--
-- Y la referencia de los pedidos se comporta EXACTAMENTE como el id del extra,
-- comprobado sobre ventas reales: `27e285fc…` es «mayo smokey» en SEIS marcas,
-- `cf46e298…` es «sweet chili t» en cinco. Cada referencia lleva un solo
-- nombre; cero colisiones. Es la decisión 1 de Julio medida: un extra puede
-- estar en cualquier marca, y es la misma tarrina.
--
-- ── Por qué una columna nueva y no cambiar `external_id` ──────────────────
--
-- Porque `external_id` es la CLAVE con la que el importador casa una fila de
-- Last con la de Folvy (`uq_modifier_option_external`), y esa clave tiene que
-- seguir siendo el hueco: es lo único único por pregunta. Si se cambiara al id
-- del extra, las nueve copias de un mismo nombre colapsarían en una fila y el
-- importador empezaría a pisarse a sí mismo. Se añade al lado, y no se toca
-- el índice único.
--
-- ── Por qué el índice NO es único ────────────────────────────────────────
--
-- Porque el mismo extra está a propósito en varias preguntas y varias marcas.
-- Un índice único aquí sería una afirmación falsa sobre los datos, y además
-- reventaría la primera importación: hoy mismo hay 56 nombres con más de un
-- hueco, que mañana compartirán `pos_modifier_id`.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.modifier_option
  ADD COLUMN IF NOT EXISTS pos_modifier_id text;

COMMENT ON COLUMN public.modifier_option.pos_modifier_id IS
  'Id del EXTRA en el TPV de origen (Last: om.modifierId). Compartido entre preguntas y marcas, a diferencia de external_id, que es el hueco. Lo rellena lastapp-catalog-import.';

-- Parcial, para que no ocupe con las filas que no son de un TPV, y NO único.
CREATE INDEX IF NOT EXISTS ix_modifier_option_pos_modifier
  ON public.modifier_option (account_id, external_source, pos_modifier_id)
  WHERE pos_modifier_id IS NOT NULL;
