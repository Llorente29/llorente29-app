-- PROPUESTA_20260831T1900_supplier_iva_incluido.sql
-- ============================================================================
-- NO APLICADA. Claude Code propone, Julio ejecuta y verifica.
-- Cuando se aplique: renombrar el fichero a la HORA REAL de aplicación
-- (patrón de la casa: el nombre tiene que decir cuándo pasó) y quitar el
-- prefijo PROPUESTA_.
--
-- ENCARGO CODE (31/08) «El albarán con IVA incluido: el coste se guarda, pero
-- la pantalla no lo enseña» — punto 4, segunda mitad.
--
-- QUÉ FALTA Y POR QUÉ
-- El arreglo de pantalla (las dos cifras con su nombre, la precisión del €/g,
-- la confirmación al guardar y la casilla «lleva IVA» por línea) NO necesita
-- base de datos: va desplegado y funcionando sin esto. Lo único que falta aquí
-- son las DOS COSAS que se guardan en la ficha del proveedor:
--   · el valor por defecto («AMIRSA factura con IVA incluido, al 10 %»), y
--   · el aviso del punto 5, que solo puede saltar si se sabe que ese proveedor
--     factura con el IVA dentro.
-- Hasta que esto se aplique, la ficha del proveedor ESCONDE el control (no lo
-- enseña roto) y la casilla por línea sigue funcionando a mano. Verificado en
-- el front: se lee con select('*') y un mapeo tolerante, igual que notify_group,
-- así que ni antes ni después hay un despliegue que coordinar.
--
-- LO QUE ESTO NO HACE, A PROPÓSITO
-- NO toca ni una línea de goods_receipt_line. Cero UPDATE sobre el histórico.
-- La pregunta abierta del encargo —¿qué proveedores facturan con el IVA
-- dentro?— no se puede contestar desde los datos: en Cloudtown (597 líneas),
-- Makro (79), Europastry (22)… unit_cost = doc_amount, y eso es lo NORMAL si
-- el albarán lista base imponible y suma el IVA al pie. Marcar un proveedor
-- por esa coincidencia sería inventarse la respuesta. Julio mira un papel de
-- cada uno y marca; hasta entonces, sin marca no hay aviso.
--
-- NO ES EL MODELO DE IVA QUE YA EXISTE, Y NO LO SUSTITUYE
-- En producción ya viven `vat_category`, `vat_rate` y `family_vat_default`
-- (verificado el 31/08 en information_schema). Ese modelo responde a OTRA
-- pregunta: QUÉ TIPO DE IVA LLEVA UN ARTÍCULO — categoría fiscal versionada por
-- fecha, para repercutir y para validar facturas antiguas por OCR.
-- Lo de aquí es una pregunta distinta: CÓMO ESCRIBE SUS IMPORTES ESTE
-- PROVEEDOR — si el número que pone en la línea del albarán ya lleva el IVA
-- dentro o es base imponible. Un mismo artículo al 10 % lo puede facturar
-- AMIRSA con el IVA dentro y Makro con base imponible: el tipo es del artículo,
-- la costumbre de escribirlo es del proveedor. Por eso son dos columnas en
-- `supplier` y no una fila más en `vat_rate`.
-- `default_vat_rate` es solo el tipo HABITUAL de ese proveedor, para no tener
-- que elegirlo en cada línea. Si algún día la categoría fiscal del artículo se
-- consulta desde la recepción, ese es el sitio del que debe salir el tipo, y
-- esta columna pasa a ser el respaldo — no al revés.
--
-- Comprobación de que no se ha movido nada del histórico (antes y después):
--   select count(*) as lineas,
--          md5(string_agg(id::text || ':' || coalesce(unit_cost::text,'-') || ':'
--                         || coalesce(doc_amount::text,'-'), ',' order by id)) as huella
--     from goods_receipt_line;
--   -- 31/08 18:00, antes de este encargo: 921 lineas, huella
--   --   0f41e326de3f2b17c6ef8fc6bf45a16f
-- ============================================================================

begin;

-- ── 1. Las dos columnas ─────────────────────────────────────────────────────
-- `prices_include_vat` NOT NULL DEFAULT false: el caso por defecto es el
-- habitual (albarán con base imponible por línea). Un default NULL obligaría a
-- cada lector a decidir qué significa "no se sabe", y ya hay un sitio donde eso
-- se decide (el front distingue "columna ausente" de "false" por la propia
-- ausencia de la clave, no por su valor).
alter table public.supplier
  add column if not exists prices_include_vat boolean not null default false,
  add column if not exists default_vat_rate   numeric;

comment on column public.supplier.prices_include_vat is
  'ENCARGO 31/08: este proveedor factura con el IVA DENTRO del importe de linea '
  '(AMIRSA lo hace). Es una SUGERENCIA para la recepcion: propone el neto y lo '
  'ensena antes de guardar, nunca lo aplica en silencio. false = el albaran '
  'lista base imponible por linea y suma el IVA al pie (lo habitual).';
comment on column public.supplier.default_vat_rate is
  'Tipo de IVA habitual del proveedor, EN PORCENTAJE (10, no 0.10). Solo tiene '
  'sentido con prices_include_vat = true. Editable por linea siempre.';

-- Un tipo de IVA negativo o por encima de 100 no es un tipo de IVA. Se admite
-- 0 (hay lineas exentas) y se admite NULL (no se sabe todavia).
alter table public.supplier
  drop constraint if exists supplier_default_vat_rate_valido;
alter table public.supplier
  add constraint supplier_default_vat_rate_valido
  check (default_vat_rate is null or (default_vat_rate >= 0 and default_vat_rate <= 100));

-- ── 2. AMIRSA nace con la casilla puesta al 10 % ───────────────────────────
-- Lo pide el encargo, y es el unico proveedor del que hay PRUEBA en los datos:
-- el ALB-00134 se corrigio a mano dividiendo entre 1,10 (92 -> 83,636363 y
-- 99 -> 90), y el ALB-00080 del 30/07 quedo con el IVA dentro. Ningun otro
-- proveedor se marca aqui: sin mirar un papel, marcarlo seria adivinar.
--
-- Anclado por nombre CON GUARDA, porque `supplier` puede tener homonimos: si
-- aparece mas de una fila, para y que lo decida un humano (misma leccion que
-- las locations duplicadas del 29/08, donde anclar por nombre habria cerrado
-- el local equivocado).
do $amirsa$
declare
  v_n  int;
  v_id uuid;
begin
  select count(*), min(id) into v_n, v_id
  from public.supplier
  where name ilike 'AMIRSA%' and coalesce(is_active, true) = true;

  if v_n = 0 then
    raise notice 'AMIRSA no encontrada: no se marca nada. Marcalo a mano en su ficha.';
  elsif v_n > 1 then
    raise exception 'ABORTA: hay % proveedores que empiezan por AMIRSA. Anclar por nombre '
                    'marcaria al equivocado. Marcalo a mano en la ficha del bueno.', v_n;
  else
    update public.supplier
       set prices_include_vat = true,
           default_vat_rate   = 10,
           updated_at         = now()
     where id = v_id;
    raise notice 'AMIRSA (%) marcada: factura con IVA incluido al 10 %%.', v_id;
  end if;
end
$amirsa$;

-- ── 3. GUARDA FINAL ────────────────────────────────────────────────────────
do $ver$
declare v_n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'supplier'
                    and column_name = 'prices_include_vat') then
    raise exception 'prices_include_vat no quedo creada';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'supplier'
                    and column_name = 'default_vat_rate') then
    raise exception 'default_vat_rate no quedo creada';
  end if;

  -- Y lo que de verdad importa: que el historico siga intacto.
  select count(*) into v_n from public.goods_receipt_line;
  raise notice 'goods_receipt_line: % lineas (esta migracion no toca ninguna).', v_n;
end
$ver$;

commit;

-- ── DESPUES DE APLICAR ─────────────────────────────────────────────────────
-- 1) Volver a sacar la huella de goods_receipt_line y comprobar que es la
--    misma de arriba. Si cambia, algo mas escribio mientras tanto: mirarlo.
-- 2) En la ficha de proveedor aparece el bloque «Cómo factura». AMIRSA sale ya
--    marcada al 10 %.
-- 3) La pregunta abierta sigue abierta: mirar un papel de Cloudtown, Makro,
--    Europastry, Coheldi, Olimpo y Bodega de Vallecas y marcar los que
--    facturen con el IVA dentro. Hasta que se marquen, el aviso del punto 5 no
--    salta para ellos — a proposito.
