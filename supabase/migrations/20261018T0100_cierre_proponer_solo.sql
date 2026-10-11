-- ============================================================================
-- Cierre del día · 2 — EL CIERRE TAMBIÉN PROPONE (encargo del 11/10)
-- ----------------------------------------------------------------------------
-- cambia: public.journal_entry_proponer · prueba: supabase/staging/sql/20261018_cierre_proponer_prueba.sql
-- cambia: public.conta_cierre_del_dia_todas · prueba: supabase/staging/sql/20261018_cierre_proponer_prueba.sql
--
-- El porqué (medido en producción, solo lectura, el 11/10): el cron horario
-- solo cierra pedidos; los resúmenes y los asientos de ventas del día solo los
-- crea journal_entry_proponer, y a esa función solo la llama el botón
-- «Proponer» del Libro diario. Los 12 resúmenes que hay son de UN clic, el
-- 09/10 entre las 15:15:56 y las 15:16:01 UTC; desde entonces nadie ha pulsado.
--
-- Lo que hace este fichero:
--   1. conta_euros_exactos / conta_numero_texto: cómo escribe el núcleo los
--      importes («1.042,55 €») y los tipos («10»), para que el porqué del
--      asiento diga lo mismo lo proponga quien lo proponga.
--   2. conta_propuesta_ventas_dia: la regla del núcleo
--      (src/modules/conta/lib/asientosPropuestos.ts, ventasDelDia, y el
--      contexto de propuestasLibroService.ts) pasada a SQL. Solo lee. Devuelve
--      la propuesta tal como la espera journal_entry_proponer, o por qué no
--      propone. Es SQL puro a propósito: el mismo texto se ejecuta en línea en
--      producción, en solo lectura, para compararlo con el núcleo (regla 31).
--   3. _journal_entry_proponer: el cuerpo de journal_entry_proponer sin la
--      comprobación de quién llama, con quién propone como parámetro.
--      journal_entry_proponer (misma firma) comprueba y llama a esta. Un
--      cerrojo por día y local evita que el botón y el cron dupliquen.
--   4. sales_day_proposal_log: qué pasó la última vez con cada día y local
--      (propuesto, ya estaba, descartado, sin propuesta y por qué, o fallo).
--      Lo que no se propone se dice (regla 8); lo lee el agente del Libro.
--   5. conta_proponer_dias: los días cerrados y abiertos (ejercicio abierto,
--      después del corte, mes sin cerrar) que no tienen asiento vivo.
--   6. conta_cierre_del_dia_todas: después de cerrar cada empresa, propone.
--      Lo que falla en un día se apunta y no frena a los demás; el
--      procedimiento termina con ERROR para que pg_cron lo cuente.
--
-- No valida nada: «Validar solos los Seguros de ventas» (ajuste de la
-- empresa) lo sigue haciendo solo el botón. En producción está apagado en la
-- única empresa (journal_autovalidate_sales_day = false, medido el 11/10).
--
-- Vuelta atrás: supabase/vuelta-atras/20261018T0100_cierre_proponer_solo.down.sql
-- ============================================================================

-- ── 1 · Cómo escribe el núcleo los números ─────────────────────────────────
-- formato.ts, eurosExactos: «−1.042,55 €» (signo menos tipográfico, punto de
-- miles siempre, dos decimales).
create or replace function public.conta_euros_exactos(p numeric)
returns text language sql immutable set search_path = public as $$
  select (case when p < 0 then '−' else '' end)
      || regexp_replace((floor(round(abs(p) * 100) / 100))::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g')
      || ',' || lpad((round(abs(p) * 100)::bigint % 100)::text, 2, '0') || ' €'
$$;

-- Un número como lo escribe JavaScript: 10.00 → «10», 5.50 → «5.5».
create or replace function public.conta_numero_texto(p numeric)
returns text language sql immutable set search_path = public as $$
  select case when p::text like '%.%' then rtrim(rtrim(p::text, '0'), '.') else p::text end
$$;

-- ── 2 · La propuesta de las ventas de un día y un local ────────────────────
-- Espejo de ventasDelDia (reglas 6 y 13). Lo que el núcleo hace con números
-- de coma flotante aquí va en céntimos exactos: cent(x) = round(x × 100),
-- que redondea igual (mitad hacia fuera) en los importes de dos decimales.
create or replace function public.conta_propuesta_ventas_dia(p_company uuid, p_location uuid, p_dia date)
returns jsonb language sql stable security definer set search_path = public as $$
with
emp as (
  select c.id, c.account_id, t.sales_tax_rate_code from public.company c
    left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company
),
tipo as (
  select r.id, r.rate, public.conta_numero_texto(r.rate) as txt from public.tax_rate r, emp
   where r.code = emp.sales_tax_rate_code and r.tax_system = 'iva' and r.valid_to is null
     and (r.is_system or r.account_id = emp.account_id)
   order by r.is_system, r.id limit 1
),
hoja as (
  select a.template_code, min(a.code) as code from public.company_account a
   where a.company_id = p_company and a.kind = 'template' and a.status is distinct from 'cerrada' and a.template_code in ('700', '708')
   group by 1
),
cta as (
  select (select code from hoja where template_code = '700') as ventas,
         coalesce((select code from hoja where template_code = '708'), (select code from hoja where template_code = '700')) as devoluciones,
         (select a.code from public.company_account_link k join public.company_account a on a.id = k.company_account_id, tipo
           where k.company_id = p_company and k.entity = 'tax_rate' and k.entity_id = tipo.id::text and k.role = 'repercutido'
           order by a.code limit 1) as iva477
),
canal as (
  select ch.id, ch.name,
         (select a.code from public.party_role pr
            join public.company_account_link k on k.company_id = p_company and k.entity = 'customer' and k.entity_id = pr.party_id::text and k.role = 'principal'
            join public.company_account a on a.id = k.company_account_id
           where pr.account_id = ch.account_id and pr.role = 'platform' and pr.channel_id = ch.id
           order by pr.party_id, a.code limit 1) as cuenta
    from public.sales_channel ch, emp where ch.account_id = emp.account_id
),
loc as (select coalesce((select l.name from public.locations l, emp where l.id = p_location and l.account_id = emp.account_id), 'local') as nombre),
ped as (
  select x.* from public.conta_pedidos_del_dia(p_company, p_location, p_dia) with ordinality as x(id, codigo, canal_id, marca_id, propia, estado, total, base, cuota, tipos, ord)
),
fila as (  -- los tickets de tus marcas: base y cuota del pedido si cuadran; si no, del total al tipo
  select p.*,
         (p.base is not null and p.cuota is not null and round(p.base * 100) + round(p.cuota * 100) = round(p.total * 100)) as trae,
         exists (select 1 from unnest(p.tipos) t where t <> tipo.rate) as otro,
         round(p.total * 100) as c_total,
         case when p.base is not null and p.cuota is not null and round(p.base * 100) + round(p.cuota * 100) = round(p.total * 100)
              then round(p.base * 100)
              else sign(p.total) * round(abs(round(p.total * 100)) * 100 / (100 + tipo.rate)) end as c_base
    from ped p, tipo where p.propia and p.estado = 'closed'
),
fila2 as (
  select f.*, case when f.trae then round(f.cuota * 100) else f.c_total - f.c_base end as c_cuota from fila f
),
dev as (
  select o.*, round(o.importe * 100) as c_imp,
         sign(o.importe) * round(abs(round(o.importe * 100)) * 100 / (100 + tipo.rate)) as c_base
    from public.conta_devoluciones_del_dia(p_company, p_location, p_dia) with ordinality as o(pedido_id, codigo, canal_id, marca_id, propia, importe, ord), tipo
   where o.propia
),
dev2 as (select d.*, d.c_imp - d.c_base as c_cuota, coalesce(d.codigo, d.pedido_id::text) as ref from dev d),
tot as (
  select count(*) as n, coalesce(sum(c_total), 0) as c_total, coalesce(sum(c_base), 0) as c_base, coalesce(sum(c_cuota), 0) as c_cuota,
         bool_or(not trae) as calculada, count(*) filter (where otro) as otro
    from fila2
),
por_canal as (select canal_id, sum(c_total) as c, min(ord) as o from fila2 group by canal_id),
por_marca as (select marca_id, sum(c_base) as c, min(ord) as o from fila2 group by marca_id),
cuentas_cobro as (
  select pc.canal_id, pc.o, (select cuenta from canal where canal.id = pc.canal_id) as cuenta,
         case when pc.canal_id is null then 'sin canal' else coalesce((select name from canal where canal.id = pc.canal_id), 'un canal') end as nombre
    from por_canal pc
),
sin_cuenta as (  -- canales de lo cobrado y de lo devuelto sin su 430, en orden de aparición y sin repetir
  select nombre, min(o) as o from (
    select nombre, o from cuentas_cobro where cuenta is null
    union all
    select case when d.canal_id is null then 'sin canal' else coalesce((select name from canal where canal.id = d.canal_id), 'un canal') end,
           100000000 + d.ord
      from dev2 d where d.canal_id is null or (select cuenta from canal where canal.id = d.canal_id) is null
  ) z group by nombre
),
cnt as (
  select (select count(*) from ped where not propia and estado = 'closed') as cedidas,
         (select coalesce(sum(round(total * 100)), 0) from ped where not propia and estado = 'closed') as c_cedidas,
         (select count(*) from ped where estado = 'cancelled') as cancelados,
         (select count(*) from ped where estado = 'open' and propia) as abiertos,
         (select count(*) from dev2) as devs,
         (select coalesce(sum(c_imp), 0) from dev2) as c_devs
),
lineas as (
  select jsonb_agg(l.j order by l.k1, l.k2, l.k3) as j from (
    select 1 as k1, cc.o as k2, 0 as k3, jsonb_build_object('cuenta', cc.cuenta, 'debe', round(pc.c / 100, 2), 'haber', 0, 'concepto', 'Cobra ' || cc.nombre,
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null) as j
      from cuentas_cobro cc join por_canal pc on pc.canal_id is not distinct from cc.canal_id
    union all
    select 2, pm.o, 0, jsonb_build_object('cuenta', cta.ventas, 'debe', 0, 'haber', round(pm.c / 100, 2), 'concepto', 'Ventas de tus marcas',
             'local_id', p_location, 'comun', false, 'marca_id', pm.marca_id, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null)
      from por_marca pm, cta
    union all
    select 3, 0, 0, jsonb_build_object('cuenta', cta.iva477, 'debe', 0, 'haber', round(tot.c_cuota / 100, 2), 'concepto', 'IVA repercutido ' || tipo.txt || ' %',
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', null,
             'iva', jsonb_build_object('tipo_id', tipo.id, 'base', round(tot.c_base / 100, 2), 'libro', 'issued', 'deducible', null, 'facturas', tot.n), 'retencion', null)
      from tot, cta, tipo where tot.n > 0
    union all
    select 4, d.ord, 1, jsonb_build_object('cuenta', cta.devoluciones, 'debe', round(d.c_base / 100, 2), 'haber', 0, 'concepto', 'Devolución del pedido ' || coalesce(d.ref, 'sin código'),
             'local_id', p_location, 'comun', false, 'marca_id', d.marca_id, 'tercero_id', null, 'documento', d.ref, 'iva', null, 'retencion', null)
      from dev2 d, cta
    union all
    select 4, d.ord, 2, jsonb_build_object('cuenta', cta.iva477, 'debe', round(d.c_cuota / 100, 2), 'haber', 0, 'concepto', trim('IVA de la devolución ' || coalesce(d.ref, '')),
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', d.ref,
             'iva', jsonb_build_object('tipo_id', tipo.id, 'base', round(d.c_base / 100, 2), 'libro', 'issued', 'deducible', null, 'facturas', 1), 'retencion', null)
      from dev2 d, cta, tipo
    union all
    select 4, d.ord, 3, jsonb_build_object('cuenta', (select cuenta from canal where canal.id = d.canal_id), 'debe', 0, 'haber', round(d.c_imp / 100, 2),
             'concepto', 'Devuelve ' || case when d.canal_id is null then 'sin canal' else coalesce((select name from canal where canal.id = d.canal_id), 'un canal') end,
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', d.ref, 'iva', null, 'retencion', null)
      from dev2 d
  ) l
),
razones as (
  select jsonb_agg(r.j order by r.k) as j from (
    select 1 as k, jsonb_build_object('decision', tot.n || ' ticket' || case when tot.n = 1 then '' else 's' end || ' de tus marcas, ' || public.conta_euros_exactos(round(tot.c_total / 100, 2)),
             'porque', 'una factura simplificada por pedido, anotadas juntas en un asiento resumen del día con base y cuota por tipo',
             'cita', 'Código de Comercio, art. 28.2; RD 1624/1992 (Reglamento del IVA), art. 63.4') as j from tot
    union all
    select 2, jsonb_build_object('decision', 'IVA al ' || tipo.txt || ' %', 'porque', 'reparto de comida = servicio de restauración: criterio de tu empresa',
             'cita', 'Ley 37/1992, art. 91.Uno.2.2.º') from tipo
    union all
    select 3, jsonb_build_object('decision', cnt.devs || ' devolución' || case when cnt.devs = 1 then '' else 'es' end || ' de ' || public.conta_euros_exactos(round(cnt.c_devs / 100, 2)),
             'porque', 'la plataforma devolvió al cliente después de la venta: menos venta y menos IVA, contra lo que cobra la plataforma, el día en que se produce',
             'cita', 'Ley 37/1992, art. 80.Dos') from cnt where cnt.devs > 0
    union all
    select 4, jsonb_build_object('decision', 'Base calculada',
             'porque', 'algún pedido no trae la base imponible: la calculo del total al ' || tipo.txt || ' % (el tipo de tus ventas); no la invento, la deduzco y lo digo')
      from tot, tipo where tot.calculada
    union all
    select 5, jsonb_build_object('decision', 'Fuera: ' || cnt.cedidas || ' pedidos de marcas cedidas (' || public.conta_euros_exactos(round(cnt.c_cedidas / 100, 2)) || ')',
             'porque', 'son ventas del socio y su IVA es del socio: entran solo en su liquidación mensual, que comparas con estos tickets',
             'cita', 'Ley 37/1992, art. 11.Dos.15.º') from cnt where cnt.cedidas > 0
    union all
    select 6, jsonb_build_object('decision', 'Fuera: ' || cnt.cancelados || ' cancelado' || case when cnt.cancelados = 1 then '' else 's' end,
             'porque', 'cancelado antes de entregar no es venta') from cnt where cnt.cancelados > 0
    union all  -- los avisos van detrás, como «Mira esto» (propuestasLibroService.ts, aJson)
    select 7, jsonb_build_object('decision', 'Mira esto',
             'porque', tot.otro || ' pedido' || case when tot.otro = 1 then ' trae' else 's traen' end || ' en sus líneas un tipo distinto del ' || tipo.txt || ' %: mira cuáles antes de validar.')
      from tot, tipo where tot.otro > 0
  ) r
),
resumen as (
  select jsonb_build_object(
    'location_id', p_location, 'sales_day', p_dia, 'tickets_count', tot.n, 'total', round(tot.c_total / 100, 2),
    'by_rate', jsonb_build_array(jsonb_build_object('tax_rate_id', tipo.id, 'rate', public.conta_numero_texto(tipo.rate)::numeric, 'base', round(tot.c_base / 100, 2), 'cuota', round(tot.c_cuota / 100, 2), 'calculated', coalesce(tot.calculada, false))),
    'by_channel', coalesce((select jsonb_agg(jsonb_build_object('channel_id', canal_id, 'total', round(c / 100, 2)) order by o) from por_canal), '[]'),
    'by_brand', coalesce((select jsonb_agg(jsonb_build_object('brand_id', marca_id, 'base', round(c / 100, 2)) order by o) from por_marca), '[]'),
    'detail_hash', encode(sha256(convert_to(
        coalesce((select string_agg(id::text, '|' order by id::text collate "C") from fila2), '') || '#' || tot.c_total::bigint::text, 'UTF8')), 'hex'),
    'sale_ids', coalesce((select jsonb_agg(id order by id::text collate "C") from fila2), '[]'),
    'base_calculated', coalesce(tot.calculada, false)) as j
  from tot left join tipo on true   -- sin tipo de ventas no hay propuesta, pero sí respuesta (abajo)
)
select case
  when (select id from tipo) is null or cta.iva477 is null or cta.ventas is null then
    jsonb_build_object('sin_propuesta', 'Falta el IVA de tus ventas (Tu empresa) o su 477, o la 700 en el plan.')
  when tot.n = 0 and cnt.devs = 0 then
    jsonb_build_object('sin_propuesta', case when cnt.cedidas > 0 then 'Ese día solo hubo ventas de marcas cedidas: van en la liquidación del socio.' else 'Ese día no hubo ventas de tus marcas.' end)
  when cnt.abiertos > 0 then
    jsonb_build_object('sin_propuesta', 'El cierre del día aún no ha pasado por este día: ' || cnt.abiertos || ' pedido' || case when cnt.abiertos = 1 then '' else 's' end
      || ' de tus marcas ' || case when cnt.abiertos = 1 then 'sigue abierto' else 'siguen abiertos' end || '. Pasa cada hora a los 7 minutos; vuelve a proponer después.')
  when exists (select 1 from sin_cuenta) then
    jsonb_build_object('sin_propuesta', 'No sé a qué cuenta va lo que cobra ' || (select string_agg(nombre, ', ' order by o) from sin_cuenta)
      || ': enlaza su 430 en su ficha (Clientes y proveedores › Plataformas).')
  when tot.n > 0 and abs(tot.c_cuota - sign(tot.c_base) * round(abs(tot.c_base * (select rate from tipo)) / 100)) > floor(0.55 * tot.n + 0.5) then
    jsonb_build_object('sin_propuesta', 'La cuota de los tickets (' || public.conta_euros_exactos(round(tot.c_cuota / 100, 2)) || ') se aleja de la base × '
      || (select txt from tipo) || ' % más de medio céntimo por ticket: hay pedidos con otro tipo.')
  else jsonb_build_object(
    'entrada', jsonb_build_object(
      'series', 1, 'fecha', p_dia, 'concepto', 'Ventas del día · ' || loc.nombre, 'source_type', 'sales_day', 'source_id', null,
      'confianza', case when tot.otro > 0 then 'duda' when tot.calculada then 'probable' else 'seguro' end,
      'porque', tot.n || ' tickets de tus marcas cuadran con lo que cobran las plataformas, al céntimo'
                || case when tot.calculada then '; base calculada al ' || (select txt from tipo) || ' %' else '' end || '.',
      'razones', razones.j, 'party_id', null, 'documento', null),
    'lineas', lineas.j,
    'resumen', resumen.j)
  end
from tot, cnt, cta, loc, lineas, razones, resumen
$$;
comment on function public.conta_propuesta_ventas_dia(uuid, uuid, date) is
  'Cierre del día 2: la propuesta del asiento de ventas de un día y un local (espejo de ventasDelDia del núcleo), o {sin_propuesta: por qué}. Solo lee.';
revoke all on function public.conta_propuesta_ventas_dia(uuid, uuid, date) from public, anon, authenticated;

-- ── 3 · Proponer, quien sea el que propone ─────────────────────────────────
-- El cuerpo de journal_entry_proponer tal cual (20261010T0120, §7), con quién
-- propone como parámetro y un cerrojo por día y local.
create or replace function public._journal_entry_proponer(p_company uuid, p_entry jsonb, p_lines jsonb, p_summary jsonb, p_quien_nombre text, p_quien uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_fecha date := (p_entry->>'fecha')::date; v_tipo text := p_entry->>'source_type';
  v_origen uuid := nullif(p_entry->>'source_id', '')::uuid; v_clave text; v_y uuid; v_id uuid; v_l jsonb; v_pos int := 0;
  v_cta uuid; v_resumen uuid; v_existente uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then
    raise exception 'La empresa % no existe.', p_company using errcode = '23514';
  end if;
  if v_tipo = 'sales_day' then
    v_clave := (p_summary->>'location_id') || ':' || (p_summary->>'sales_day');
    -- El botón y el cierre del día pueden llegar a la vez al mismo día.
    perform pg_advisory_xact_lock(hashtextextended('sales_day:' || p_company::text || ':' || v_clave, 0));
  else
    v_clave := v_origen::text;
  end if;
  if v_clave is not null and exists (select 1 from public.journal_dismissal d where d.company_id = p_company and d.source_type = v_tipo and d.source_key = v_clave) then
    return jsonb_build_object('descartada', true);
  end if;

  if v_tipo = 'sales_day' then
    select s.id, s.entry_id into v_resumen, v_existente from public.sales_day_summary s
     where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date;
    if v_existente is not null and exists (select 1 from public.journal_entry e where e.id = v_existente and e.status in ('propuesto', 'borrador', 'validado')) then
      return jsonb_build_object('id', v_existente, 'existente', true);
    end if;
    if v_resumen is null then
      insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, tickets_count, total, by_rate, by_channel, by_brand,
                                            first_invoice, last_invoice, detail_hash, sale_ids, base_calculated, created_by)
      values (v_cuenta, p_company, (p_summary->>'location_id')::uuid, (p_summary->>'sales_day')::date, (p_summary->>'tickets_count')::int,
              (p_summary->>'total')::numeric, coalesce(p_summary->'by_rate', '[]'), coalesce(p_summary->'by_channel', '[]'), coalesce(p_summary->'by_brand', '[]'),
              p_summary->>'first_invoice', p_summary->>'last_invoice', p_summary->>'detail_hash',
              coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
              coalesce((p_summary->>'base_calculated')::boolean, false), p_quien)
      returning id into v_resumen;
    else
      -- Un resumen sin asiento vivo (el del 09/10 de Carabanchel, de antes del
      -- cierre del día) se rehace entero con el día de ahora: no se duplica.
      update public.sales_day_summary set tickets_count = (p_summary->>'tickets_count')::int, total = (p_summary->>'total')::numeric,
             by_rate = coalesce(p_summary->'by_rate', '[]'), by_channel = coalesce(p_summary->'by_channel', '[]'), by_brand = coalesce(p_summary->'by_brand', '[]'),
             detail_hash = p_summary->>'detail_hash',
             sale_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
             base_calculated = coalesce((p_summary->>'base_calculated')::boolean, false), entry_id = null
       where id = v_resumen;
    end if;
    v_origen := v_resumen;
  elsif v_origen is not null then
    select id into v_existente from public.journal_entry
     where company_id = p_company and source_type = v_tipo and source_id = v_origen and status in ('propuesto', 'borrador', 'validado');
    if v_existente is not null then return jsonb_build_object('id', v_existente, 'existente', true); end if;
  end if;

  select id into v_y from public.fiscal_year where company_id = p_company and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_y, (p_entry->>'series')::smallint, v_fecha, p_entry->>'concepto', v_tipo, v_origen, 'propuesto',
          p_entry->>'confianza', p_entry->>'porque', coalesce(p_entry->'razones', '[]'), nullif(p_entry->>'party_id', '')::uuid,
          p_entry->>'documento', nullif(p_entry->>'fecha_documento', '')::date, p_quien, coalesce(p_quien_nombre, 'Folvy'))
  returning id into v_id;

  for v_l in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    select id into v_cta from public.company_account where company_id = p_company and code = v_l->>'cuenta';
    if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', v_l->>'cuenta' using errcode = '23514'; end if;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     brand_id, party_id, document_ref, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents,
                                     withholding_rate_id, withholding_base, withholding_model)
    values (v_cuenta, p_company, v_id, v_pos, v_cta, coalesce((v_l->>'debe')::numeric, 0), coalesce((v_l->>'haber')::numeric, 0), v_l->>'concepto',
            nullif(v_l->>'local_id', '')::uuid, coalesce((v_l->>'comun')::boolean, false), nullif(v_l->>'marca_id', '')::uuid,
            nullif(v_l->>'tercero_id', '')::uuid, v_l->>'documento',
            nullif(v_l->'iva'->>'tipo_id', '')::uuid, (v_l->'iva'->>'base')::numeric, v_l->'iva'->>'libro', v_l->'iva'->>'deducible',
            coalesce((v_l->'iva'->>'facturas')::int, 1),
            nullif(v_l->'retencion'->>'tipo_id', '')::uuid, (v_l->'retencion'->>'base')::numeric, v_l->'retencion'->>'modelo');
  end loop;
  if v_resumen is not null then update public.sales_day_summary set entry_id = v_id where id = v_resumen; end if;
  return jsonb_build_object('id', v_id, 'existente', false);
end $$;
revoke all on function public._journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text, uuid) from public, anon, authenticated;

-- Misma firma: solo cambia que el cuerpo vive en _journal_entry_proponer.
create or replace function public.journal_entry_proponer(p_company uuid, p_entry jsonb, p_lines jsonb, p_summary jsonb default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone asientos.' using errcode = '42501';
  end if;
  return public._journal_entry_proponer(p_company, p_entry, p_lines, p_summary, p_quien_nombre, auth.uid());
end $$;

-- ── 4 · Qué pasó la última vez con cada día ────────────────────────────────
create table if not exists public.sales_day_proposal_log (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  company_id    uuid not null references public.company(id) on delete cascade,
  location_id   uuid not null,
  sales_day     date not null,
  result        text not null check (result in ('propuesto', 'ya_estaba', 'descartado', 'sin_propuesta', 'fallo')),
  reason        text,
  entry_id      uuid,
  attempts      integer not null default 1,
  first_at      timestamptz not null default now(),
  last_at       timestamptz not null default now()
);
comment on table public.sales_day_proposal_log is
  'Cierre del día 2: lo último que hizo el cierre del día con las ventas de cada día y local (propuesto, ya estaba, descartado, sin propuesta y por qué, o fallo). Una fila por día y local; attempts cuenta las pasadas. Lo escribe solo conta_proponer_dias.';
create unique index if not exists ux_sales_day_proposal_log on public.sales_day_proposal_log (company_id, location_id, sales_day);
alter table public.sales_day_proposal_log enable row level security;
drop policy if exists sales_day_proposal_log_select on public.sales_day_proposal_log;
create policy sales_day_proposal_log_select on public.sales_day_proposal_log for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
-- Sin políticas de escritura: solo la escribe conta_proponer_dias (security definer).
revoke all on table public.sales_day_proposal_log from anon;

-- ── 5 · Proponer los días cerrados que no tienen asiento ───────────────────
-- Los mismos días que el botón (proponer.ts y libro.ts, diaAbierto): ejercicio
-- abierto, después del corte (imported_until), mes sin cerrar, y como mucho el
-- último día cerrado. Sin corte y con ventas de antes del ejercicio, el botón
-- pregunta desde cuándo asienta Folvy: eso es de una persona, y aquí no se
-- propone ese ejercicio (se dice en lo que devuelve).
create or replace function public.conta_proponer_dias(p_company uuid, p_ahora timestamptz default now(), p_quien text default 'Folvy (cierre del día)')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_hasta date; y record; d record; v_p jsonb; v_r jsonb; v_res text; v_porque text; v_entry uuid;
  v_n jsonb := jsonb_build_object('propuestos', 0, 'ya_estaban', 0, 'descartados', 0, 'sin_propuesta', 0, 'fallos', 0);
  v_fallos text[] := '{}'; v_preguntar text[] := '{}';
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Proponer: la empresa % no existe.', p_company; end if;
  v_hasta := public.conta_ultimo_dia_cerrado(p_company, p_ahora);

  for y in select f.* from public.fiscal_year f where f.company_id = p_company and f.status = 'open' and f.starts_on <= v_hasta order by f.starts_on loop
    if y.imported_until is null
       and exists (select 1 from public.sale s where s.account_id = v_cuenta and s.sold_at < (y.starts_on::timestamp at time zone 'Europe/Madrid'))
       and not exists (select 1 from public.journal_entry e where e.company_id = p_company and e.fiscal_year_id = y.id) then
      v_preguntar := v_preguntar || y.code::text;
      continue;
    end if;
    for d in
      select x.location_id, x.dia from public.conta_dias_por_asentar(p_company, greatest(y.starts_on, coalesce(y.imported_until + 1, y.starts_on)), least(v_hasta, y.ends_on)) x
       where not exists (select 1 from public.fiscal_period_lock k where k.company_id = p_company and k.month = date_trunc('month', x.dia)::date and k.reopened_at is null)
       order by x.dia, x.location_id
    loop
      v_entry := null; v_porque := null;
      begin
        v_p := public.conta_propuesta_ventas_dia(p_company, d.location_id, d.dia);
        if v_p is null then
          raise exception 'la propuesta del día ha salido vacía (ni asiento ni porqué)';
        elsif v_p ? 'sin_propuesta' then
          v_res := 'sin_propuesta'; v_porque := v_p->>'sin_propuesta';
        else
          v_r := public._journal_entry_proponer(p_company, v_p->'entrada', v_p->'lineas', v_p->'resumen', p_quien, null);
          v_res := case when (v_r->>'descartada')::boolean then 'descartado' when (v_r->>'existente')::boolean then 'ya_estaba' else 'propuesto' end;
          v_entry := nullif(v_r->>'id', '')::uuid;
        end if;
      exception when others then
        v_res := 'fallo'; v_porque := format('%s (%s)', sqlerrm, sqlstate);
        v_fallos := v_fallos || format('%s %s: %s', d.dia, d.location_id, sqlerrm);
      end;
      insert into public.sales_day_proposal_log as g (account_id, company_id, location_id, sales_day, result, reason, entry_id)
      values (v_cuenta, p_company, d.location_id, d.dia, v_res, v_porque, v_entry)
      on conflict (company_id, location_id, sales_day) do update
        set result = excluded.result, reason = excluded.reason, entry_id = excluded.entry_id, attempts = g.attempts + 1, last_at = now();
      v_n := jsonb_set(v_n, array[case v_res when 'propuesto' then 'propuestos' when 'ya_estaba' then 'ya_estaban' when 'descartado' then 'descartados'
                                              when 'sin_propuesta' then 'sin_propuesta' else 'fallos' end],
                       to_jsonb((v_n->>case v_res when 'propuesto' then 'propuestos' when 'ya_estaba' then 'ya_estaban' when 'descartado' then 'descartados'
                                                  when 'sin_propuesta' then 'sin_propuesta' else 'fallos' end)::int + 1));
    end loop;
  end loop;
  return v_n || jsonb_build_object('company_id', p_company, 'hasta', v_hasta, 'errores', to_jsonb(v_fallos), 'preguntar_ejercicio', to_jsonb(v_preguntar));
end $$;
comment on function public.conta_proponer_dias(uuid, timestamptz, text) is
  'Cierre del día 2: propone las ventas de los días cerrados y abiertos que no tienen asiento vivo, y apunta en sales_day_proposal_log lo que pasó con cada uno. Lo llama el cierre del día cada hora.';
revoke all on function public.conta_proponer_dias(uuid, timestamptz, text) from public, anon, authenticated;

-- ── 6 · El cierre del día, cada hora: cerrar y después proponer ────────────
create or replace procedure public.conta_cierre_del_dia_todas()
language plpgsql as $procedure$
declare
  r        record;
  v_p      jsonb;
  v_fallos text[] := '{}';
begin
  for r in select c.id from public.company c order by c.id loop
    begin
      perform public.conta_cerrar_dias(r.id, now());
    exception when others then
      v_fallos := v_fallos || format('%s: %s (%s)', r.id, sqlerrm, sqlstate);
    end;
    commit;
    -- Después de cerrar: lo que ya está cerrado se propone. Un día que falla
    -- se apunta en sales_day_proposal_log y no frena a los demás.
    begin
      v_p := public.conta_proponer_dias(r.id, now());
      if (v_p->>'fallos')::int > 0 then
        v_fallos := v_fallos || format('%s: proponer falló en %s día(s): %s', r.id, v_p->>'fallos', v_p->>'errores');
      end if;
    exception when others then
      v_fallos := v_fallos || format('%s: proponer: %s (%s)', r.id, sqlerrm, sqlstate);
    end;
    commit;
  end loop;
  if cardinality(v_fallos) > 0 then
    raise exception 'Cierre del día: falló en % paso(s): %', cardinality(v_fallos), array_to_string(v_fallos, ' · ');
  end if;
end
$procedure$;
