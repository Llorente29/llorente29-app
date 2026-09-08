-- ══════════════════════════════════════════════════════════════════════════
-- «Nuevo del TPV» · decisión A, migración 1 — `external_product_map` gana el eje
-- que le faltaba: QUÉ CLASE de identificador guarda cada fila
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. El nombre de este fichero es PROVISIONAL a propósito: cuando
-- Julio la aplique, se renombra a la versión que registre la base (regla 17).
-- Un fichero con una versión inventada es un cadáver esperando (B88).
--
-- ── QUÉ ES ESTA TABLA Y POR QUÉ NO SE CREA, SE RETOMA ─────────────────────
--
-- El encargo la daba por nueva. Existe desde el 11/06 y está abandonada: 43
-- filas escritas TODAS el 10/07 en una sola tanda, nadie la ha tocado desde
-- entonces y nadie la lee — sólo aparece en el tipo generado de TypeScript.
--
-- ── EL PROBLEMA QUE ARREGLA ───────────────────────────────────────────────
--
-- Last manda TRES identificadores distintos para lo mismo, y ninguno sirve para
-- todos los casos:
--
--   organizationProductId → el producto suelto. Es el único que lee hoy
--                           `adapt_lastapp_order`, y los packs llegan con él a
--                           NULL, así que los packs no casan por id nunca.
--   organizationComboId   → la cabecera del pack. 642 de 645 en 30 días.
--   catalogProductId      → el producto en el catálogo. 645 de 645.
--
-- La tabla de hoy tiene UNA columna, `external_product_id`, y su restricción
-- única es `(account_id, source, external_product_id)`. Meter los tres ejes ahí
-- es pedir que un `organizationComboId` y un `catalogProductId` se peleen por la
-- misma clave el día que coincidan. Es el mismo defecto que la decisión A quería
-- evitar al no reutilizar `menu_item.external_id`, una capa más abajo.
--
-- ── LO QUE HACE, Y LO QUE NO ──────────────────────────────────────────────
--
-- Añade `external_kind`, cambia la restricción única y documenta las columnas.
-- **No cambia ni una fila de datos** y **no toca el adaptador**: eso es la
-- migración 2, y va aparte para que ésta se pueda revisar sola.
--
-- ── EL `default 'product'` ESTÁ MEDIDO, NO SUPUESTO ───────────────────────
--
-- Las 43 filas existentes: 43 de 43 aparecen en `sale_line.external_product_id`
-- con el mismo `external_source`, o sea que las 43 son `organizationProductId`.
-- Medido el 08/09 antes de escribir esto. Si mañana alguien mete otra clase a
-- mano antes de aplicar, la guarda de abajo lo caza.
--
-- ── LAS 6 QUE APUNTAN A PLATOS ARCHIVADOS SE QUEDAN ───────────────────────
--
-- Decisión de Julio (08/09): no se borra nada a ciegas. El adaptador las
-- ignorará (migración 2) y «Nuevo del TPV» las enseñará con su motivo. Aquí sólo
-- se dejan estar: borrar la huella de que ese id existió es peor que tenerla.
--
-- ── LA RESTRICCIÓN NUEVA ES MÁS DÉBIL, ASÍ QUE NO PUEDE FALLAR ────────────
--
-- Pasa de 3 columnas a 4: todo lo que cumplía la vieja cumple la nueva. No hay
-- forma de que los datos de hoy la violen. Lo contrario —estrecharla— sí habría
-- necesitado un recuento previo.
--
-- ── LAS DOS COMPROBACIONES QUE HACEN QUE ESTO SEA SEGURO ──────────────────
--
-- 1. NADA DEPENDE DE LA RESTRICCIÓN QUE SE QUITA: cero claves ajenas apuntan a
--    `external_product_map_uq` (consultado `pg_constraint.confrelid` el 08/09).
--    Quitarla y volver a ponerla no arrastra a nadie.
-- 2. LA GUARDA NO VA A TARDAR: su subconsulta usa
--    `sale_line_external_match_idx (external_source, external_product_id)`, que
--    ya existe. Son 43 búsquedas por índice sobre 28.497 filas, no un barrido.
--    Una guarda lenta se acaba quitando, y entonces no guarda nada.

begin;

-- ── 1 · La columna ────────────────────────────────────────────────────────
alter table public.external_product_map
  add column if not exists external_kind text not null default 'product';

-- Los tres valores y nada más. Sin esto, un `kind` mal escrito no rompe nada
-- hoy y deja de casar en silencio mañana — que es la peor forma de fallar.
alter table public.external_product_map
  drop constraint if exists external_product_map_kind_ck;
alter table public.external_product_map
  add constraint external_product_map_kind_ck
  check (external_kind in ('product', 'combo', 'catalog'));

-- ── 2 · La unicidad, con el eje dentro ────────────────────────────────────
-- Es una RESTRICCIÓN, no un índice suelto: se quita con ALTER TABLE. Un
-- `drop index external_product_map_uq` fallaría con «no se puede eliminar
-- porque la restricción lo requiere».
alter table public.external_product_map
  drop constraint if exists external_product_map_uq;
alter table public.external_product_map
  add constraint external_product_map_uq
  unique (account_id, source, external_kind, external_product_id);

-- ── 3 · Que la tabla diga lo que es ───────────────────────────────────────
comment on table public.external_product_map is
  'Casado por IDENTIFICADOR entre lo que manda el TPV y el plato de Folvy. '
  'Una fila por (cuenta, origen, clase de id, id). Sustituye al casado por '
  'nombre exacto, que se rompe con «Birria + Tequeños AMB» y «(AMB)». '
  'La escribe el casado de «Nuevo del TPV»; la lee adapt_lastapp_order.';

comment on column public.external_product_map.external_kind is
  'QUÉ CLASE de identificador es, porque Last manda tres y no son intercambiables: '
  '«product» = organizationProductId (producto suelto; NULL en los packs), '
  '«combo» = organizationComboId (la cabecera del pack), '
  '«catalog» = catalogProductId (el producto en el catálogo). '
  'El adaptador los prueba en ese orden: combo, catalog, product, y el nombre '
  'exacto queda de último recurso.';

comment on column public.external_product_map.external_product_id is
  'El identificador tal como llega, sin normalizar. Qué clase es lo dice external_kind.';

comment on column public.external_product_map.external_brand_id is
  'La marca externa, cuando la línea la trae. Informativo: el casado va por producto. '
  'Koreans llega con DOS ids de marca, así que esto no vale como clave.';

comment on column public.external_product_map.menu_item_id is
  'El plato de Folvy. Puede estar ARCHIVADO: 6 de las 43 filas de hoy lo están, '
  'y se quedan a propósito (decisión de Julio, 08/09). Quien lea esta tabla para '
  'casar una venta tiene que descartar los archivados por su cuenta.';

-- ── 4 · Guarda: si algo no queda como se dice arriba, esto ABORTA ─────────
do $guarda$
declare
  v_n_kind   int;
  v_n_uq     int;
  v_no_product int;
begin
  select count(*) into v_n_kind
  from information_schema.columns
  where table_schema='public' and table_name='external_product_map'
    and column_name='external_kind';
  if v_n_kind <> 1 then
    raise exception 'GUARDA: no ha quedado la columna external_kind.';
  end if;

  select count(*) into v_n_uq
  from pg_constraint con join pg_class c on c.oid=con.conrelid
  where c.relname='external_product_map' and con.conname='external_product_map_uq'
    and pg_get_constraintdef(con.oid) like '%external_kind%';
  if v_n_uq <> 1 then
    raise exception 'GUARDA: la restriccion unica no lleva external_kind dentro.';
  end if;

  -- Las 43 de hoy son organizationProductId, medido. Si al aplicar hubiera
  -- alguna que NO se ve en ventas como external_product_id, el default seria
  -- una suposicion y no una medida: mejor abortar y volver a mirar.
  select count(*) into v_no_product
  from public.external_product_map m
  where m.external_kind = 'product'
    and not exists (
      select 1 from public.sale_line sl
      where sl.external_source = m.source
        and sl.external_product_id = m.external_product_id);
  if v_no_product > 0 then
    raise exception
      'GUARDA: % filas marcadas como product no aparecen en ventas con ese id. '
      'El default dejo de estar medido: revisar antes de seguir.', v_no_product;
  end if;
end
$guarda$;

commit;

-- ── Verificación, para pegar el resultado (regla 5) ───────────────────────
--
--   select external_kind, count(*) from public.external_product_map group by 1;
--     → product: 43   (y ninguna otra clase todavía)
--
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'external_product_map_uq';
--     → UNIQUE (account_id, source, external_kind, external_product_id)
