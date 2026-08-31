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
-- EL TIPO NO VIVE AQUI. DECISION DE JULIO (31/08)
-- Esta migracion anade UNA columna: un booleano. NO hay `default_vat_rate`.
--
-- El tipo es del ARTICULO; la costumbre de meterlo o no en el importe de linea
-- es del PROVEEDOR. Son dos ejes distintos y mezclarlos crea una segunda
-- verdad sobre el tipo que ademas gana por estar mas a mano: un mismo pollo al
-- 10 % lo factura AMIRSA con el IVA dentro y Makro con base imponible, y el
-- 10 % es del pollo en los dos casos.
--
-- El tipo sale del modelo fiscal que YA existe en produccion (verificado el
-- 31/08 en information_schema y contado fila a fila):
--   recipe_item.vat_category_id -> vat_rate vigente por fecha
--   y si el articulo no tiene categoria, family_vat_default por nombre de
--   familia, que es la cascada que el propio modelo trae.
--   Si no hay ni una cosa ni la otra, LA PANTALLA LO DICE Y PIDE EL TIPO.
--
-- Estado del catalogo fiscal el 31/08, que es lo que hace que preguntar tenga
-- que estar bien resuelto y no ser un caso raro de esquina:
--   5 categorias · 6 tipos (5 vigentes hoy) · 16 familias mapeadas, 6 MIXTAS
--   1.072 articulos, de los cuales 273 (25 %) tienen categoria propia.
-- Una familia MIXTA no resuelve: `is_mixed` significa "esta familia tiene
-- varios tipos", asi que su defecto es una lista de candidatos, no una
-- respuesta. Y una categoria con vat_category_source = 'proposed' resuelve
-- pero viaja marcada, para que la pantalla diga que aun no la ha confirmado
-- nadie -- que es para lo que el modelo distingue 'proposed' de 'confirmed'.
--
-- Comprobado sobre el caso real: los dos articulos del ALB-00134 (Kebab Pollo
-- Loncheado y Kebab Ternera Loncheado, familia «Carnes y aves») estan en
-- 'alimento_general' = 10 %, que es exactamente el tipo que Pamela aplico a
-- mano. La cascada devuelve la respuesta correcta sin que nadie la teclee.
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

-- ── 1. La columna. UNA, y booleana ─────────────────────────────────────────
-- NOT NULL DEFAULT false: el caso por defecto es el habitual (albaran con base
-- imponible por linea). Un default NULL obligaria a cada lector a decidir que
-- significa "no se sabe", y ya hay un sitio donde eso se decide: el front
-- distingue "columna ausente" de "false" por la ausencia de la clave en la
-- fila, no por su valor.
alter table public.supplier
  add column if not exists iva_incluido_en_linea boolean not null default false;

comment on column public.supplier.iva_incluido_en_linea is
  'ENCARGO 31/08: este proveedor factura con el IVA DENTRO del importe de linea '
  '(AMIRSA lo hace). Es una SUGERENCIA para la recepcion: propone el neto y lo '
  'ensena antes de guardar, nunca lo aplica en silencio. false = el albaran '
  'lista base imponible por linea y suma el IVA al pie (lo habitual). '
  'AQUI NO VA EL TIPO: el tipo es del articulo (vat_category/vat_rate, con '
  'family_vat_default de cascada) y esta columna solo dice COMO escribe sus '
  'importes el proveedor.';

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
       set iva_incluido_en_linea = true,
           updated_at            = now()
     where id = v_id;
    raise notice 'AMIRSA (%) marcada: factura con IVA incluido. El tipo lo pone cada articulo.', v_id;
  end if;
end
$amirsa$;

-- ── 3. GUARDA FINAL ────────────────────────────────────────────────────────
do $ver$
declare v_n int; v_t text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'supplier'
                    and column_name = 'iva_incluido_en_linea') then
    raise exception 'iva_incluido_en_linea no quedo creada';
  end if;

  -- Y que NO se haya colado un tipo en el proveedor: el tipo es del articulo.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'supplier'
                and column_name in ('default_vat_rate', 'vat_rate')) then
    raise exception 'supplier tiene una columna de TIPO de IVA. El tipo es del articulo '
                    '(vat_category/vat_rate); en el proveedor solo va la costumbre.';
  end if;

  -- La cascada del articulo tiene que existir, o el front se queda preguntando
  -- el tipo SIEMPRE y esto no sirve de nada.
  foreach v_t in array array['vat_category','vat_rate','family_vat_default'] loop
    if to_regclass('public.'||v_t) is null then
      raise exception 'falta %, que es de donde sale el tipo', v_t;
    end if;
  end loop;

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
-- 4) Lo que de verdad hace util esto a medio plazo NO es esta columna, son las
--    799 fichas de articulo sin categoria fiscal (1.072 - 273). Cada una que se
--    clasifique es una linea que deja de preguntar el tipo. La pantalla ya dice
--    cuales son: aparecen pidiendolo al corregir.
