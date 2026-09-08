-- ══════════════════════════════════════════════════════════════════════════
-- «Nuevo del TPV» · decisión A, migración 2 — casar por IDENTIFICADOR
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Nombre provisional: se renombra a la versión que registre la
-- base (regla 17). Depende de la migración 1 (`external_kind`).
--
-- ── EL PROBLEMA, MEDIDO HOY SOBRE 30 DÍAS DE FOODINT ──────────────────────
--
--   cabeceras de combo ................................. 630
--   con organizationComboId ............................ 627
--   con catalogProductId ............................... 630
--   con organizationProductId (EL ÚNICO QUE LEE HOY) ...   0
--   ids de combo distintos / nombres distintos ......... 52 / 53
--   casan hoy por nombre exacto ........................ 331  (52,5 %)
--
-- Las tres cifras que importan: los packs NUNCA traen el identificador que el
-- adaptador lee, SIEMPRE traen otros dos que no mira, y 52 ids cubren 53
-- nombres — o sea que el id funde «Birria + Tequeños AMB» y «(AMB)» sin
-- normalizar nada. Hoy se pierde uno de cada dos packs por una grafía.
--
-- ── QUÉ ES ESTO Y QUÉ NO ES ───────────────────────────────────────────────
--
-- Es la PIEZA de casado, sola y probable por su cuenta. NO toca todavía
-- `adapt_lastapp_order`: esa función tiene 11.341 caracteres y su reescritura
-- va aparte, para que este trozo —que es donde está la regla— se pueda leer y
-- discutir sin 300 líneas alrededor. Al final del fichero está el punto exacto
-- donde se enchufa.
--
-- ── EL ORDEN, Y POR QUÉ ESE ──────────────────────────────────────────────
--
--   1. combo    → organizationComboId. Es el identificador de la CABECERA del
--                 pack, el más específico que manda Last para lo que se vendió.
--   2. catalog  → catalogProductId. Existe en 630 de 630, pero es el producto
--                 EN EL CATÁLOGO: un mismo plato aparece en varios catálogos
--                 por canal, así que es más ancho. Va después.
--   3. product  → organizationProductId, para las líneas que no son pack.
--
-- El nombre exacto NO desaparece: se queda de último recurso en el adaptador,
-- porque hoy resuelve 331 de 630 y quitarlo antes de que el mapa esté poblado
-- rompería la mitad de lo que funciona. Se retira cuando el mapa lo cubra.
--
-- ── LO QUE NO HACE, A PROPÓSITO ───────────────────────────────────────────
--
-- No inventa filas de mapa. El mapa lo escribe una PERSONA desde «Nuevo del
-- TPV», confirmando. Un pack mal compuesto descuenta almacén de lo que no
-- salió, y eso no se arregla solo (§2.4 del encargo).
--
-- ── PLATOS ARCHIVADOS: LA FILA SE IGNORA, NO SE BORRA ─────────────────────
--
-- Decisión de Julio (08/09). 6 de las 43 filas de hoy apuntan a un plato
-- archivado. Casar contra él descontaría almacén de algo retirado, así que
-- aquí se salta como si no existiera — pero la fila se queda, y «Nuevo del
-- TPV» la enseña con su motivo. Que la venta caiga en «sin casar» es
-- exactamente lo que queremos: se ve y se arregla.

begin;

create or replace function public.casa_por_id_externo(
  p_account  uuid,
  p_source   text,
  p_elem     jsonb,     -- el elemento de `sale.raw_products` tal como llegó
  p_is_combo boolean
)
returns uuid
language sql
stable
security invoker
set search_path to 'public'
as $$
  -- Los tres identificadores que puede traer la línea, con la clase que les
  -- toca. `nullif(...,'')` porque Last manda cadena vacía, no null, cuando no
  -- lo tiene: sin esto se buscaría el id '' y se casaría con cualquier fila
  -- que alguien guardara en blanco.
  with candidatos(orden, clase, id_externo) as (
    values
      (1, 'combo',   nullif(p_elem->>'organizationComboId', '')),
      (2, 'catalog', nullif(p_elem->>'catalogProductId', '')),
      (3, 'product', nullif(p_elem->>'organizationProductId', ''))
  )
  select m.menu_item_id
  from candidatos c
  join external_product_map m
    on  m.account_id          = p_account
    and m.source              = p_source
    and m.external_kind       = c.clase
    and m.external_product_id = c.id_externo
  join menu_item mi
    on  mi.id = m.menu_item_id
    -- El plato archivado no cuenta: su precio y su receta son los del día en
    -- que se archivó. Mejor «sin casar» y visible que casado y falso.
    and mi.archived_at is null
  where c.id_externo is not null
    -- Una cabecera de pack NO se casa por `product`: ese identificador, cuando
    -- viene, es el de un componente, y casarlo daría el plato suelto en vez del
    -- pack. Medido: en 630 cabeceras viene 0 veces, pero la guarda es barata y
    -- el día que Last lo mande, el fallo sería silencioso.
    and (not p_is_combo or c.clase <> 'product')
  order by c.orden
  limit 1
$$;

comment on function public.casa_por_id_externo(uuid, text, jsonb, boolean) is
  'Casa una línea de venta del TPV con un plato de Folvy POR IDENTIFICADOR, en '
  'orden combo → catalog → product. Devuelve null si ninguno está en '
  '`external_product_map` o si el plato al que apunta está archivado. '
  'No escribe nada: el mapa lo rellena una persona desde «Nuevo del TPV». '
  'Medido el 08/09: los packs traen organizationComboId en 627 de 630 y '
  'catalogProductId en 630 de 630, y NUNCA organizationProductId — que es el '
  'único que leía `adapt_lastapp_order`.';

-- ── Guarda: que la pieza haga lo que dice, comprobado con datos de verdad ──
do $guarda$
declare
  v_acc      uuid;
  v_map      record;
  v_esperado uuid;
  v_dio      uuid;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='external_product_map'
                   and column_name='external_kind') then
    raise exception 'GUARDA: falta external_kind. Aplicar antes la migracion 1.';
  end if;

  -- Una fila REAL del mapa, con su plato vivo: la función tiene que encontrarla.
  select m.*, m.account_id into v_map
  from external_product_map m
  join menu_item mi on mi.id = m.menu_item_id and mi.archived_at is null
  limit 1;

  if v_map is null then
    raise notice 'GUARDA: no hay ninguna fila de mapa con plato vivo; no se puede probar en vivo.';
    return;
  end if;

  v_acc := v_map.account_id;
  v_esperado := v_map.menu_item_id;

  -- (a) por su clase, la encuentra
  v_dio := public.casa_por_id_externo(
    v_acc, v_map.source,
    jsonb_build_object('organizationProductId', v_map.external_product_id),
    false);
  if v_dio is distinct from v_esperado then
    raise exception 'GUARDA: no casa una fila real del mapa (dio %, esperaba %).', v_dio, v_esperado;
  end if;

  -- (b) una cabecera de pack NO se casa por el id de producto
  v_dio := public.casa_por_id_externo(
    v_acc, v_map.source,
    jsonb_build_object('organizationProductId', v_map.external_product_id),
    true);
  if v_dio is not null then
    raise exception 'GUARDA: una cabecera de pack se ha casado por organizationProductId.';
  end if;

  -- (c) la cadena vacía no casa con nada
  if public.casa_por_id_externo(v_acc, v_map.source,
       jsonb_build_object('organizationComboId', ''), true) is not null then
    raise exception 'GUARDA: la cadena vacia esta casando.';
  end if;

  -- (d) un id que no existe devuelve null, no revienta
  if public.casa_por_id_externo(v_acc, v_map.source,
       jsonb_build_object('organizationComboId', 'no-existe-jamas'), true) is not null then
    raise exception 'GUARDA: un id inexistente ha casado con algo.';
  end if;
end
$guarda$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DÓNDE SE ENCHUFA (migración 2b, aparte — no está en este fichero)
-- ══════════════════════════════════════════════════════════════════════════
--
-- En `adapt_lastapp_order`, dentro del bucle `FOR v_elem IN … raw_products`,
-- ANTES del casado de hoy y sin quitarlo:
--
--     v_menu := public.casa_por_id_externo(v_acc, 'lastapp', v_elem, v_is_combo);
--     IF v_menu IS NOT NULL THEN
--       SELECT mi.brand_id INTO v_menu_brand FROM menu_item mi WHERE mi.id = v_menu;
--     END IF;
--
--     IF v_menu IS NULL THEN
--       …aquí queda EXACTAMENTE lo que hay hoy: external_id para producto,
--         nombre exacto dentro de la marca para combo…
--     END IF;
--
-- ADITIVO, no sustitutivo, y ésa es la parte importante: el mapa tiene hoy 43
-- filas y las 331 cabeceras que casan por nombre tienen que seguir casando.
-- Sustituir en vez de añadir rompería la mitad de lo que funciona para arreglar
-- la otra mitad.
--
-- La reescritura de esa función va en su propio fichero, sobre el cuerpo VIVO
-- leído de `pg_proc.prosrc` —no sobre el .sql del repo, que puede no ser el que
-- corre (B88)— y con `CREATE OR REPLACE`: no cambia la firma, así que no toca
-- DROP + CREATE (regla 2).
--
-- ── Verificación, para pegar el resultado (regla 5) ───────────────────────
--
--   Antes  (hoy):     331 de 630 cabeceras casan, por nombre exacto.
--   Después (techo):  627 por organizationComboId + 3 por catalogProductId,
--                     PERO sólo cuando el mapa tenga esos 52 ids dentro — y eso
--                     lo escribe una persona confirmando en «Nuevo del TPV».
--                     El día que se aplique esto SOLO, el número no se mueve:
--                     el mapa no tiene ni una fila de clase combo.
--   Eso NO es un fallo: es que esta migración abre la puerta y la pantalla es
--   la que la cruza. Decirlo evita que alguien aplique y concluya que no sirve.
