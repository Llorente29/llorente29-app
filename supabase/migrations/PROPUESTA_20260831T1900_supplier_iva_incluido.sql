-- PROPUESTA_20260831T1900_supplier_iva_incluido.sql
-- ============================================================================
-- NO APLICADA. Claude Code propone, Julio ejecuta y verifica.
-- Cuando se aplique: renombrar el fichero a la HORA REAL de aplicación
-- (patrón de la casa: el nombre tiene que decir cuándo pasó) y quitar el
-- prefijo PROPUESTA_.
--
-- ENCARGO CODE (31/08) «El albarán con IVA incluido: el coste se guarda, pero
-- la pantalla no lo enseña» — punto 4, segunda mitad, MAS el anadido de Julio
-- del 31/08 por la tarde (guardar en la ficha el tipo que se responde).
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
-- Estado del catalogo fiscal el 31/08 (Foodint, articulos activos):
--   5 categorias · 6 tipos (5 vigentes hoy) · 16 familias mapeadas, 6 MIXTAS
--   352 articulos activos, 188 con categoria propia (53 %):
--     43 CONFIRMADAS y 145 solo PROPUESTAS.
-- (Un recuento anterior decia 273 de 1.072: era `recipe_item` ENTERA, que es
--  multi-cuenta e incluye el catalogo plantilla del sistema. Corregido por
--  Julio. Leer una tabla multi-cuenta sin su account_id da un numero que no es
--  de nadie -- y aqui habria hecho parecer raro lo que es mayoritario.)
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

-- ── 1-bis. De donde salio la categoria fiscal de un articulo ───────────────
-- ANADIDO AL ALCANCE POR JULIO (31/08): cuando la recepcion pregunta el tipo
-- porque no se sabia, la pantalla OFRECE guardarlo en la ficha del articulo
-- como categoria CONFIRMADA, "con su origen anotado". Que el catalogo fiscal se
-- complete con el trabajo diario en vez de con una tarde de despacho.
--
-- `vat_category_source` ya distingue 'proposed' de 'confirmed', pero no dice
-- QUIEN lo confirmo ni DESDE DONDE. Sin eso, dentro de seis meses hay 145
-- categorias confirmadas y ninguna forma de saber si las confirmo alguien
-- mirando un albaran o un clic con prisa. Tres columnas, todas nullable:
-- aditivo puro, no rompen ninguna fila existente.
alter table public.recipe_item
  add column if not exists vat_category_origin text,
  add column if not exists vat_category_set_at  timestamptz,
  add column if not exists vat_category_set_by  uuid;

comment on column public.recipe_item.vat_category_origin is
  'De donde salio esta categoria fiscal, en texto legible. Hoy lo escribe la '
  'verificacion de recepcion: "recepcion ALB-00134 (AMIRSA)". NULL = viene de '
  'antes de 31/08/2026, o la puso el motor. Se escribe SOLO junto con '
  'vat_category_source = confirmed.';
comment on column public.recipe_item.vat_category_set_at is
  'Cuando se confirmo la categoria fiscal. NULL = nunca se confirmo a mano.';
comment on column public.recipe_item.vat_category_set_by is
  'auth.uid() de quien la confirmo. NULL = nadie, o viene de antes.';

-- ── 2. AMIRSA queda marcada. POR ID, no por nombre ─────────────────────────
-- Lo pide el encargo, y es el unico proveedor del que hay PRUEBA en los datos:
-- el ALB-00134 se corrigio a mano dividiendo entre 1,10 (92 -> 83,636363 y
-- 99 -> 90), y el ALB-00080 del 30/07 quedo con el IVA dentro.
--
-- SE ANCLA POR ID, Y NO POR NOMBRE, PORQUE HAY DOS AMIRSA.
-- Comprobado el 31/08 a las 20:00, antes de aplicar nada:
--   3048d4f8-b1eb-4352-ad2d-64583b0f4f93  CIF B87123790  4 albaranes
--       (ALB-00134, ALB-00094, ALB-00080, ALB-00074; el ultimo, hoy)  <- ESTA
--   a47f80b7-9e41-4b20-a387-93e06d9b0bff  sin CIF        0 albaranes
--       (ficha duplicada, creada el 07/06, nunca usada para recibir)
--
-- Las dos estan activas y se llaman EXACTAMENTE igual. La version anterior de
-- esta migracion anclaba por nombre con una guarda que abortaba al encontrar
-- mas de una: habria abortado la migracion ENTERA. Es la leccion del 29/08 con
-- los locales duplicados —anclar por nombre habria cerrado el local
-- equivocado— repetida aqui con proveedores.
--
-- La guarda de abajo no comprueba el nombre: comprueba que el MUNDO sigue
-- siendo el que se verifico. Si la ficha buena dejo de tener el ALB-00134, o
-- si la duplicada ha empezado a recibir mercancia, para y que lo mire un
-- humano: querria decir que alguien ha estado usando la otra ficha y entonces
-- marcar solo una seria dejar el aviso ciego para la mitad de los albaranes.
--
-- La ficha duplicada NO se toca aqui: fusionar o archivar proveedores es otra
-- decision y es de Julio. Queda anotada en el aviso de abajo.
do $amirsa$
declare
  v_buena     uuid := '3048d4f8-b1eb-4352-ad2d-64583b0f4f93';
  v_duplicada uuid := 'a47f80b7-9e41-4b20-a387-93e06d9b0bff';
  v_n         int;
begin
  if not exists (select 1 from public.supplier
                  where id = v_buena and coalesce(is_active, true) = true) then
    raise exception 'ABORTA: la ficha de AMIRSA verificada (%) no existe o esta archivada. '
                    'Mirar cual es la buena AHORA y marcarla a mano.', v_buena;
  end if;

  if not exists (select 1 from public.goods_receipt
                  where supplier_id = v_buena and code = 'ALB-00134') then
    raise exception 'ABORTA: la ficha % ya no tiene el ALB-00134, que es el albaran del '
                    'encargo. El mundo no es el que se verifico: parar y comprobar.', v_buena;
  end if;

  select count(*) into v_n from public.goods_receipt where supplier_id = v_duplicada;
  if v_n > 0 then
    raise exception 'ABORTA: la ficha duplicada de AMIRSA (%) ha recibido % albaran(es) desde '
                    'que se verifico. Marcar solo una dejaria el aviso ciego para la otra: '
                    'decidir a mano cual se usa, o marcar las dos.', v_duplicada, v_n;
  end if;

  update public.supplier
     set iva_incluido_en_linea = true,
         updated_at            = now()
   where id = v_buena;

  raise notice 'AMIRSA (%) marcada: factura con IVA incluido. El tipo lo pone cada articulo.', v_buena;
  raise warning 'AVISO, fuera del alcance de esta migracion: hay una SEGUNDA ficha de AMIRSA '
                '(%) activa, sin CIF y sin albaranes, con 2 articulos vinculados. No se toca. '
                'Fusionarla o archivarla es decision de Julio.', v_duplicada;
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

  -- Y las tres de procedencia, que son las que permiten que el catalogo fiscal
  -- se complete desde la recepcion sin perder de vista quien lo completo.
  foreach v_t in array array['vat_category_origin','vat_category_set_at','vat_category_set_by'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'recipe_item'
                      and column_name = v_t) then
      raise exception 'recipe_item.% no quedo creada', v_t;
    end if;
  end loop;

  -- NINGUNA ficha existente puede haberse tocado: las tres nacen NULL.
  select count(*) into v_n from public.recipe_item
   where vat_category_origin is not null or vat_category_set_at is not null
      or vat_category_set_by is not null;
  if v_n <> 0 then
    raise exception 'ABORTA: % fichas ya traen procedencia. Esta migracion solo CREA las columnas.', v_n;
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
-- 3-bis) HAY DOS FICHAS DE AMIRSA, las dos activas y con el mismo nombre. Solo
--    una recibe (4 albaranes, CIF B87123790); la otra tiene 0 albaranes, sin
--    CIF, y 2 articulos vinculados. Esta migracion marca SOLO la buena y no
--    toca la otra. Fusionarlas o archivar la vacia es una decision aparte —
--    pero conviene tomarla: mientras existan las dos, cualquier cosa que se
--    ancle por nombre de proveedor puede coger la equivocada.
-- 4) La pregunta abierta sigue abierta: mirar un papel de Cloudtown, Makro,
--    Europastry, Coheldi, Olimpo y Bodega de Vallecas y marcar los que
--    facturen con el IVA dentro. Hasta que se marquen, el aviso del punto 5 no
--    salta para ellos — a proposito.
-- 5) Lo que de verdad hace util esto a medio plazo NO es esta columna, son las
--    164 fichas activas sin categoria fiscal (352 - 188) y las 145 que estan
--    solo propuestas. Cada una que se clasifique o se confirme es una linea que
--    deja de preguntar. Desde el 31/08 la pantalla no solo las senala: OFRECE
--    guardar la respuesta en la ficha, para que el catalogo fiscal se complete
--    con el trabajo diario en vez de con una tarde de despacho.
