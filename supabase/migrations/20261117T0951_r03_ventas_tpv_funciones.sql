-- supabase/migrations/20261117T0951_r03_ventas_tpv_funciones.sql
--
-- R03 · Guardar y leer un día de ventas de un TPV de fuera (respuesta R02 · 1).
--
-- Solo AÑADE: tres funciones nuevas. No cambia ninguna que exista; nadie las
-- llama todavía (las llamarán la pantalla de subida y el día de ventas, PR 3).
--
--   conta_tpv_dia_guardar(empresa, día, programa, lectura, quién) → jsonb
--     LA ÚNICA PUERTA de las cuatro tablas del día (0950). En una transacción:
--       · quien llama es de la cuenta de la empresa y administrador o encargado
--         (como conta_cierre_guardar), o el servidor;
--       · PARA, con una frase para quien lo lee en pantalla y una pista en el
--         «hint» (r03:<cuál>) para que la pantalla sepa qué parada es:
--           r03:dia_de_inicio  el día es anterior al día de inicio de la
--                              empresa (conta_dia_de_inicio, del N02);
--           r03:contabilizado  el día ya está contabilizado;
--           r03:forma          lo leído no tiene la forma esperada, o una
--                              factura es de otro día;
--           r03:numeracion     facturas repetidas o que faltan (por contador);
--           r03:cuadre         los totales no cuadran: pagos contra facturas,
--                              IVA desglosado contra facturas, y cada factura
--                              con su base, su IVA y su total;
--       · si el día ya estaba guardado y no contabilizado, lo SUSTITUYE entero;
--       · devuelve lo guardado con contenido (regla 8): cuántas facturas, de la
--         tal a la tal, los totales y cuánto por forma de pago, y la frase.
--     La TOLERANCIA de redondeo es la del día de ventas
--     (_conta_propuesta_ventas, la guarda «la cuota se aleja de la base × tipo»):
--     |Σ cuota − Σ base × tipo| ≤ floor(0,55 · n + 0,5) céntimos, con n las
--     facturas de ese tipo (medio céntimo por factura, redondeado). Entre
--     ficheros (pagos, IVA desglosado y facturas) no hay redondeo que tolerar:
--     son sumas de los mismos importes ya redondeados, y tienen que dar lo mismo
--     al céntimo.
--   conta_tpv_dia_leer(empresa, día, programa) → jsonb (nulo si no está)
--     El día guardado con sus facturas (y su IVA), sus cobros y los totales por
--     forma de pago, canal y tipo, para la pantalla y el PR 3.
--   _conta_tpv_lista(text[]) → «a», «a y b», «a, b y c» (y «… y N más» desde
--     diez). Interna.
--
-- La lectura entra en jsonb, ya partida por día (el lector del PR 2 la parte por
-- la fecha del documento):
--   { "documentos": [{numero, contador, fecha «AAAA-MM-DD hh:mm:ss» de Madrid,
--                     orden, canal (lo de «Entrega»; «--» = en el local), nif,
--                     cliente, base, cuota, total}],
--     "impuestos":  [{orden, tipo, base, cuota}],
--     "cobros":     [{fila, orden, forma, importe}] }
--
-- Se puede pasar dos veces (create or replace, firmas nuevas).
-- Prueba: supabase/staging/sql/20261117_r03_ventas_tpv_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261117T0951_r03_ventas_tpv_funciones.down.sql

create or replace function public._conta_tpv_lista(p text[])
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(cardinality(p), 0) = 0 then ''
    when cardinality(p) = 1 then p[1]
    when cardinality(p) <= 10 then array_to_string(p[1:cardinality(p) - 1], ', ') || ' y ' || p[cardinality(p)]
    else array_to_string(p[1:10], ', ') || ' y ' || (cardinality(p) - 10) || ' más'
  end
$$;

create or replace function public.conta_tpv_dia_guardar(p_company uuid, p_dia date, p_programa text, p_lectura jsonb, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_acc uuid; v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_quien text; v_ini date; v_dia public.conta_tpv_dia; v_id uuid; v_sust boolean := false;
  v_fecha text := to_char(p_dia, 'DD/MM/YYYY');
  v_lista text[]; v_n int; v_varios boolean; v_t record;
  c_doc bigint; c_imp bigint; c_cob bigint; v_antes text;
  v_res jsonb; v_formas jsonb; v_texto text;
begin
  -- 1 · Quién ----------------------------------------------------------------------
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (v_servidor or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not (v_servidor or public.current_user_is_admin_or_manager_of(v_acc)) then
    raise exception 'Solo un administrador o un encargado de la cuenta sube las ventas del TPV.' using errcode = '42501';
  end if;
  v_quien := coalesce(p_quien_nombre, public.conta_nombre_actor());
  if p_programa is null or p_programa not in ('revo') then
    raise exception 'No sé guardar las ventas de «%»: de momento, solo las de Revo.', coalesce(p_programa, 'ese programa')
      using errcode = '22023', hint = 'r03:forma';
  end if;
  if p_dia is null then raise exception 'Falta el día de las ventas.' using errcode = '22023', hint = 'r03:forma'; end if;

  -- 2 · El día de inicio y si ya está contabilizado ----------------------------------
  v_ini := public.conta_dia_de_inicio(p_company);
  if v_ini is not null and p_dia < v_ini then
    raise exception 'Las ventas del % son de antes de tu día de inicio en Sumied (%): son del programa de antes y no se guardan.',
      v_fecha, to_char(v_ini, 'DD/MM/YYYY') using errcode = '23514', hint = 'r03:dia_de_inicio';
  end if;
  select * into v_dia from public.conta_tpv_dia where company_id = p_company and dia = p_dia and programa = p_programa for update;
  if v_dia.estado = 'contabilizado' then
    raise exception 'Las ventas del % ya están contabilizadas: no se cambian. Si hay que corregir algo, se hace desde su asiento.', v_fecha
      using errcode = '23514', hint = 'r03:contabilizado';
  end if;

  -- 3 · Lo leído, en tablas de trabajo ------------------------------------------------
  if jsonb_typeof(p_lectura -> 'documentos') is distinct from 'array' or jsonb_typeof(p_lectura -> 'impuestos') is distinct from 'array'
     or jsonb_typeof(p_lectura -> 'cobros') is distinct from 'array' then
    raise exception 'Lo leído no trae las facturas, el IVA y los pagos.' using errcode = '22023', hint = 'r03:forma';
  end if;
  drop table if exists pg_temp._r03_doc, pg_temp._r03_imp, pg_temp._r03_cob;
  begin
    create temp table _r03_doc on commit drop as
      select d.numero, btrim(d.contador) as contador, d.fecha, btrim(d.orden) as orden,
             case when btrim(coalesce(d.canal, '')) in ('', '--') then 'local' else btrim(d.canal) end as canal,
             nullif(upper(regexp_replace(coalesce(d.nif, ''), '[\s.\-]', '', 'g')), '') as nif, nullif(btrim(d.cliente), '') as cliente,
             round(d.base * 100)::bigint as c_base, round(d.cuota * 100)::bigint as c_cuota, round(d.total * 100)::bigint as c_total
        from jsonb_to_recordset(p_lectura -> 'documentos')
             as d(numero bigint, contador text, fecha timestamp, orden text, canal text, nif text, cliente text, base numeric, cuota numeric, total numeric);
    create temp table _r03_imp on commit drop as
      select btrim(i.orden) as orden, i.tipo, round(i.base * 100)::bigint as c_base, round(i.cuota * 100)::bigint as c_cuota
        from jsonb_to_recordset(p_lectura -> 'impuestos') as i(orden text, tipo numeric, base numeric, cuota numeric);
    create temp table _r03_cob on commit drop as
      select c.fila, btrim(c.orden) as orden, btrim(c.forma) as forma, round(c.importe * 100)::bigint as c_importe
        from jsonb_to_recordset(p_lectura -> 'cobros') as c(fila integer, orden text, forma text, importe numeric);
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'Lo leído tiene un número o una fecha que no entiendo (%).', sqlerrm using errcode = '22023', hint = 'r03:forma';
  end;
  if not exists (select 1 from _r03_doc) then
    raise exception 'No hay ninguna factura del % en lo leído.', v_fecha using errcode = '22023', hint = 'r03:forma';
  end if;
  if exists (select 1 from _r03_doc where numero is null or contador is null or contador = '' or fecha is null or orden is null or orden = ''
                                         or c_base is null or c_cuota is null or c_total is null) then
    raise exception 'Hay una factura sin número, sin fecha, sin orden o sin importes: así no se puede guardar.' using errcode = '22023', hint = 'r03:forma';
  end if;
  if exists (select 1 from _r03_imp where orden is null or tipo is null or c_base is null or c_cuota is null)
     or exists (select 1 from _r03_imp where tipo < 0 or tipo >= 100) then
    raise exception 'Hay un renglón del IVA sin orden, sin tipo o sin importes.' using errcode = '22023', hint = 'r03:forma';
  end if;
  if exists (select 1 from _r03_cob where fila is null or fila < 1 or orden is null or forma is null or forma = '' or c_importe is null) then
    raise exception 'Hay un pago sin fila, sin orden, sin forma de pago o sin importe.' using errcode = '22023', hint = 'r03:forma';
  end if;
  -- Cada factura, del día que se guarda (la fecha del documento, sin corte de las 2:00).
  select array_agg(format('la %s es del %s', numero, to_char(fecha, 'DD/MM/YYYY')) order by numero) into v_lista
    from _r03_doc where fecha::date <> p_dia;
  if v_lista is not null then
    raise exception 'Hay facturas que no son del %: %.', v_fecha, public._conta_tpv_lista(v_lista) using errcode = '22023', hint = 'r03:forma';
  end if;

  -- 4 · La numeración, por contador -----------------------------------------------------
  v_varios := (select count(distinct contador) from _r03_doc) > 1;
  select array_agg(x order by o) into v_lista from (
    select d.numero || case when v_varios then ' (' || d.contador || ')' else '' end as x, min(d.numero) as o
      from _r03_doc d group by d.contador, d.numero having count(*) > 1) r;
  if v_lista is not null then
    raise exception '% %.', case when cardinality(v_lista) = 1 then 'La factura ' || v_lista[1] || ' está dos veces'
                                 else 'Las facturas ' || public._conta_tpv_lista(v_lista) || ' están repetidas' end,
      '(sube los ficheros de una sola exportación)' using errcode = '23514', hint = 'r03:numeracion';
  end if;
  select array_agg(x order by c, n) into v_lista from (
    select g.n::text || case when v_varios then ' (' || r.contador || ')' else '' end as x, r.contador as c, g.n
      from (select contador, min(numero) as a, max(numero) as b from _r03_doc group by contador) r
      cross join lateral generate_series(r.a, r.b) as g(n)
     where not exists (select 1 from _r03_doc d where d.contador = r.contador and d.numero = g.n)) f;
  if v_lista is not null then
    raise exception '%.', case when cardinality(v_lista) = 1 then 'Falta la factura ' || v_lista[1]
                               else 'Faltan las facturas ' || public._conta_tpv_lista(v_lista) end
      using errcode = '23514', hint = 'r03:numeracion';
  end if;

  -- 5 · Los totales ---------------------------------------------------------------------
  select coalesce(sum(c_total), 0) into c_doc from _r03_doc;
  select coalesce(sum(c_base + c_cuota), 0) into c_imp from _r03_imp;
  select coalesce(sum(c_importe), 0) into c_cob from _r03_cob;
  if c_cob <> c_doc then
    select array_agg(orden order by orden) into v_lista from (
      select o.orden from (select orden, sum(c_total) as t from _r03_doc group by orden) o
        full join (select orden, sum(c_importe) as t from _r03_cob group by orden) p using (orden)
       where coalesce(o.t, 0) <> coalesce(p.t, 0)) z;
    raise exception 'Los pagos suman % y las facturas %. % %.%',
      public.conta_euros_exactos(c_cob / 100.0), public.conta_euros_exactos(c_doc / 100.0),
      case when c_cob < c_doc then 'Faltan' else 'Sobran' end, public.conta_euros_exactos(abs(c_doc - c_cob) / 100.0),
      case when v_lista is null then '' else ' Mira ' || case when cardinality(v_lista) = 1 then 'la orden ' else 'las órdenes ' end || public._conta_tpv_lista(v_lista) || '.' end
      using errcode = '23514', hint = 'r03:cuadre';
  end if;
  if c_imp <> c_doc then
    raise exception 'El IVA desglosado suma % y las facturas %. % %.',
      public.conta_euros_exactos(c_imp / 100.0), public.conta_euros_exactos(c_doc / 100.0),
      case when c_imp < c_doc then 'Faltan' else 'Sobran' end, public.conta_euros_exactos(abs(c_doc - c_imp) / 100.0)
      using errcode = '23514', hint = 'r03:cuadre';
  end if;
  -- Cada pago y cada renglón del IVA, de una factura de este día; un IVA, de una sola factura.
  select array_agg(format('la fila %s (orden %s)', fila, orden) order by fila) into v_lista
    from _r03_cob c where not exists (select 1 from _r03_doc d where d.orden = c.orden);
  if v_lista is not null then
    raise exception 'Hay pagos de órdenes sin factura este día: %.', public._conta_tpv_lista(v_lista) using errcode = '23514', hint = 'r03:cuadre';
  end if;
  select array_agg(fila::text order by fila) into v_lista from (select fila from _r03_cob group by fila having count(*) > 1) z;
  if v_lista is not null then
    raise exception 'El pago de la fila % está dos veces.', public._conta_tpv_lista(v_lista) using errcode = '23514', hint = 'r03:forma';
  end if;
  select array_agg(orden order by orden) into v_lista
    from (select distinct orden from _r03_imp i where not exists (select 1 from _r03_doc d where d.orden = i.orden)) z;
  if v_lista is not null then
    raise exception 'Hay IVA de órdenes sin factura este día: %.', public._conta_tpv_lista(v_lista) using errcode = '23514', hint = 'r03:cuadre';
  end if;
  select array_agg(format('la orden %s tiene las facturas %s', orden, ns) order by orden) into v_lista
    from (select orden, public._conta_tpv_lista(array_agg(numero::text order by numero)) as ns from _r03_doc group by orden having count(*) > 1) z;
  if v_lista is not null then
    raise exception 'No sé a qué factura va el IVA: %.', public._conta_tpv_lista(v_lista) using errcode = '23514', hint = 'r03:cuadre';
  end if;
  select array_agg(format('al %s %% en la orden %s', public.conta_numero_texto(tipo), orden) order by orden, tipo) into v_lista
    from (select orden, tipo from _r03_imp group by orden, tipo having count(*) > 1) z;
  if v_lista is not null then
    raise exception 'El IVA está dos veces: %.', public._conta_tpv_lista(v_lista) using errcode = '23514', hint = 'r03:cuadre';
  end if;
  -- Cada factura: su base y su IVA dan su total, y son los de su desglose.
  select array_agg(format('la %s (base %s e IVA %s, total %s)', numero, public.conta_euros_exactos(c_base / 100.0),
                          public.conta_euros_exactos(c_cuota / 100.0), public.conta_euros_exactos(c_total / 100.0)) order by numero) into v_lista
    from _r03_doc where c_base + c_cuota <> c_total;
  if v_lista is not null then
    raise exception 'En estas facturas la base y el IVA no dan el total: %.', public._conta_tpv_lista(v_lista) using errcode = '23514', hint = 'r03:cuadre';
  end if;
  select array_agg(format('la %s: %s en la factura y %s en el desglose', d.numero, public.conta_euros_exactos(d.c_total / 100.0),
                          public.conta_euros_exactos(coalesce(i.b + i.q, 0) / 100.0)) order by d.numero) into v_lista
    from _r03_doc d left join (select orden, sum(c_base) as b, sum(c_cuota) as q from _r03_imp group by orden) i on i.orden = d.orden
   where i.orden is null or i.b <> d.c_base or i.q <> d.c_cuota;
  if v_lista is not null then
    raise exception 'El IVA desglosado no es el de estas facturas: %.', public._conta_tpv_lista(v_lista) using errcode = '23514', hint = 'r03:cuadre';
  end if;
  -- La cuota de cada tipo sale de su base, con la tolerancia del día de ventas.
  for v_t in select tipo, sum(c_base) as b, sum(c_cuota) as q, count(*) as n from _r03_imp group by tipo order by tipo loop
    if abs(v_t.q - sign(v_t.b) * round(abs(v_t.b) * v_t.tipo / 100)) > floor(0.55 * v_t.n + 0.5) then
      raise exception 'El IVA al % %% (%) no sale de su base (% × % %% = %): se aleja más de medio céntimo por factura.',
        public.conta_numero_texto(v_t.tipo), public.conta_euros_exactos(v_t.q / 100.0), public.conta_euros_exactos(v_t.b / 100.0),
        public.conta_numero_texto(v_t.tipo), public.conta_euros_exactos(sign(v_t.b) * round(abs(v_t.b) * v_t.tipo / 100) / 100.0)
        using errcode = '23514', hint = 'r03:cuadre';
    end if;
  end loop;

  -- 6 · Guardar: nuevo, o sustituido entero -------------------------------------------------
  if v_dia.id is not null then
    v_sust := true;
    v_antes := format('%s factura%s y %s', v_dia.documentos, case when v_dia.documentos = 1 then '' else 's' end, public.conta_euros_exactos(v_dia.total));
    delete from public.conta_tpv_cobro where dia_id = v_dia.id;
    delete from public.conta_tpv_documento where dia_id = v_dia.id;   -- y su IVA, en cascada
    update public.conta_tpv_dia
       set documentos = (select count(*) from _r03_doc), primer_numero = (select min(numero) from _r03_doc), ultimo_numero = (select max(numero) from _r03_doc),
           base = (select sum(c_base) from _r03_doc) / 100.0, cuota = (select sum(c_cuota) from _r03_doc) / 100.0, total = c_doc / 100.0,
           subido_por = auth.uid(), subido_por_nombre = v_quien, subido_en = now()
     where id = v_dia.id;
    v_id := v_dia.id;
  else
    insert into public.conta_tpv_dia (account_id, company_id, dia, programa, documentos, primer_numero, ultimo_numero, base, cuota, total, subido_por, subido_por_nombre)
    select v_acc, p_company, p_dia, p_programa, count(*), min(numero), max(numero), sum(c_base) / 100.0, sum(c_cuota) / 100.0, sum(c_total) / 100.0, auth.uid(), v_quien
      from _r03_doc
    returning id into v_id;
  end if;
  insert into public.conta_tpv_documento (account_id, company_id, dia_id, numero, contador, fecha, orden, canal, cliente_nif, cliente_nombre, base, cuota, total)
  select v_acc, p_company, v_id, numero, contador, fecha at time zone 'Europe/Madrid', orden, canal, nif, cliente, c_base / 100.0, c_cuota / 100.0, c_total / 100.0
    from _r03_doc;
  insert into public.conta_tpv_impuesto (account_id, company_id, documento_id, tipo, base, cuota)
  select v_acc, p_company, d.id, i.tipo, i.c_base / 100.0, i.c_cuota / 100.0
    from _r03_imp i join public.conta_tpv_documento d on d.dia_id = v_id and d.orden = i.orden;
  insert into public.conta_tpv_cobro (account_id, company_id, dia_id, fila, orden, forma, importe)
  select v_acc, p_company, v_id, fila, orden, forma, c_importe / 100.0 from _r03_cob;

  -- 7 · Lo guardado, con contenido ------------------------------------------------------------
  select * into v_dia from public.conta_tpv_dia where id = v_id;
  select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'importe', importe) order by forma), '[]'::jsonb) into v_formas
    from (select forma, sum(importe) as importe from public.conta_tpv_cobro where dia_id = v_id group by forma) f;
  v_texto := format('%s las ventas del %s%s: %s factura%s, %s, %s (base %s e IVA %s). Por forma de pago: %s.',
    case when v_sust then 'Sustituidas' else 'Guardadas' end, v_fecha,
    case when v_sust then ' (las de antes, ' || v_antes || ', ya no están)' else '' end,
    v_dia.documentos, case when v_dia.documentos = 1 then '' else 's' end,
    case when v_dia.primer_numero = v_dia.ultimo_numero then 'la ' || v_dia.primer_numero else 'de la ' || v_dia.primer_numero || ' a la ' || v_dia.ultimo_numero end,
    public.conta_euros_exactos(v_dia.total), public.conta_euros_exactos(v_dia.base), public.conta_euros_exactos(v_dia.cuota),
    (select string_agg((f ->> 'forma') || ' ' || public.conta_euros_exactos((f ->> 'importe')::numeric), ' · ' order by f ->> 'forma') from jsonb_array_elements(v_formas) f));
  return jsonb_build_object(
    'id', v_id, 'company_id', p_company, 'dia', p_dia, 'programa', p_programa, 'estado', v_dia.estado, 'sustituido', v_sust,
    'documentos', v_dia.documentos, 'primero', v_dia.primer_numero, 'ultimo', v_dia.ultimo_numero,
    'base', v_dia.base, 'cuota', v_dia.cuota, 'total', v_dia.total, 'por_forma', v_formas, 'texto', v_texto);
end
$function$;

create or replace function public.conta_tpv_dia_leer(p_company uuid, p_dia date, p_programa text default 'revo')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare v_acc uuid; v_dia public.conta_tpv_dia;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  select * into v_dia from public.conta_tpv_dia where company_id = p_company and dia = p_dia and programa = p_programa and account_id = v_acc;
  if v_dia.id is null then return null; end if;
  return jsonb_build_object(
    'id', v_dia.id, 'company_id', v_dia.company_id, 'dia', v_dia.dia, 'programa', v_dia.programa, 'estado', v_dia.estado,
    'documentos', v_dia.documentos, 'primero', v_dia.primer_numero, 'ultimo', v_dia.ultimo_numero,
    'base', v_dia.base, 'cuota', v_dia.cuota, 'total', v_dia.total,
    'subido_por_nombre', v_dia.subido_por_nombre, 'subido_en', v_dia.subido_en,
    'por_forma', (select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'importe', importe) order by forma), '[]'::jsonb)
                    from (select forma, sum(importe) as importe from public.conta_tpv_cobro where dia_id = v_dia.id group by forma) f),
    'por_canal', (select coalesce(jsonb_agg(jsonb_build_object('canal', canal, 'documentos', n, 'total', total) order by canal), '[]'::jsonb)
                    from (select canal, count(*) as n, sum(total) as total from public.conta_tpv_documento where dia_id = v_dia.id group by canal) c),
    'por_tipo', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'base', base, 'cuota', cuota) order by tipo), '[]'::jsonb)
                   from (select i.tipo, sum(i.base) as base, sum(i.cuota) as cuota from public.conta_tpv_impuesto i
                           join public.conta_tpv_documento d on d.id = i.documento_id where d.dia_id = v_dia.id group by i.tipo) t),
    'facturas', (select coalesce(jsonb_agg(jsonb_build_object(
                   'numero', d.numero, 'contador', d.contador, 'fecha', to_char(d.fecha at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI:SS'),
                   'orden', d.orden, 'canal', d.canal, 'nif', d.cliente_nif, 'cliente', d.cliente_nombre,
                   'base', d.base, 'cuota', d.cuota, 'total', d.total,
                   'impuestos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', i.tipo, 'base', i.base, 'cuota', i.cuota) order by i.tipo), '[]'::jsonb)
                                   from public.conta_tpv_impuesto i where i.documento_id = d.id)) order by d.contador, d.numero), '[]'::jsonb)
                   from public.conta_tpv_documento d where d.dia_id = v_dia.id),
    'cobros', (select coalesce(jsonb_agg(jsonb_build_object('fila', c.fila, 'orden', c.orden, 'forma', c.forma, 'importe', c.importe) order by c.fila), '[]'::jsonb)
                 from public.conta_tpv_cobro c where c.dia_id = v_dia.id));
end
$function$;

comment on function public.conta_tpv_dia_guardar(uuid, date, text, jsonb, text) is
  'R03: guarda (o sustituye, si no está contabilizado) un día de ventas de un TPV de fuera, después de comprobar el día de inicio, la numeración y que cuadran facturas, IVA y pagos. La única puerta de conta_tpv_dia y sus tablas.';
comment on function public.conta_tpv_dia_leer(uuid, date, text) is
  'R03: un día de ventas del TPV guardado, con sus facturas, su IVA, sus cobros y los totales por forma de pago, canal y tipo. Nulo si no está.';

revoke all on function public._conta_tpv_lista(text[]) from public, anon, authenticated;
revoke all on function public.conta_tpv_dia_guardar(uuid, date, text, jsonb, text) from public, anon;
revoke all on function public.conta_tpv_dia_leer(uuid, date, text) from public, anon;
grant execute on function public.conta_tpv_dia_guardar(uuid, date, text, jsonb, text) to authenticated, service_role;
grant execute on function public.conta_tpv_dia_leer(uuid, date, text) to authenticated, service_role;
grant execute on function public._conta_tpv_lista(text[]) to service_role;
