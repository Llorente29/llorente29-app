-- supabase/migrations/20261113T0100_c06b_centimo_iva.sql
--
-- cambia: public.journal_entry_validar · prueba: supabase/staging/sql/20261113_c06b_centimo_iva_prueba.sql
-- cambia: public.conta_propuesta_ventas_unidad · prueba: supabase/staging/sql/20261113_c06b_centimo_iva_prueba.sql
--
-- C06b · El céntimo de redondeo en el IVA (Julio, 15/10, autoriza aflojar
-- este freno de forma expresa).
--
-- POR QUÉ: «Ventas Glovo · Foodint Carabanchel» del 13/10, propuesto. Un
-- ticket de 20,40 € con el IVA dentro da base 18,55 y cuota 1,85, y la
-- validación exige 18,55 × 10 % = 1,86: «No se valida: apunte 3 (47700010)…».
-- No hay reparto que cuadre al céntimo (18,55 + 1,86 = 20,41; 18,54 × 10 % =
-- 1,85, pero 18,54 + 1,85 = 20,39).
--
-- LO QUE CAMBIA:
--   1. journal_entry_validar, regla 5: la cuota de cada apunte de IVA puede
--      diferir como mucho un céntimo de base × tipo. Un resumen de n
--      facturas sigue admitiendo su medio céntimo por factura (floor(n/2)),
--      que desde 4 facturas es más que uno: no se estrecha nada. Cualquier
--      otra diferencia sigue parando, y la regla 1 (el asiento cuadra al
--      céntimo) no cambia. Lo demás, copiado de la versión vigente
--      (20261019T0160, la misma huella en producción el 15/10).
--   2. conta_propuesta_ventas_unidad: «1 ticket de tus marcas en Glovo cuadra»
--      y «1 pedido de marcas cedidas», con su singular y su plural. Lo demás,
--      copiado de la vigente (20261020T0100, la misma huella en producción).
--      Los propuestos que ya están guardados conservan su texto: es el de
--      cuando se propusieron.
--
-- Ninguna de las dos está en el camino del pedido: la primera la llama quien
-- valida un asiento; la segunda solo lee (el cierre del día).
-- Misma firma en las dos: create or replace no hace una sobrecarga.

-- 1 ----------------------------------------------------------------------------------
create or replace function public.journal_entry_validar(p_entry uuid, p_quien_nombre text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_debe numeric; v_haber numeric; v_n int; v_numero int; v_seq bigint; v_prev text; v_hash text;
  v_mal text; v_cierre boolean;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida asientos.' using errcode = '42501';
  end if;
  if v_e.status not in ('propuesto', 'borrador') then
    raise exception 'El asiento ya está %.', v_e.status using errcode = '23514';
  end if;

  -- Regla 1: cuadra, al céntimo.
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber
    from public.journal_line where entry_id = p_entry;
  if v_n < 2 then raise exception 'Un asiento lleva al menos dos apuntes.' using errcode = '23514'; end if;
  if v_debe <> v_haber then
    raise exception 'No cuadra: Debe % y Haber %, diferencia %.', v_debe, v_haber, v_debe - v_haber using errcode = '23514';
  end if;

  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  if v_e.entry_date not between v_y.starts_on and v_y.ends_on then
    raise exception 'La fecha % no es del ejercicio %.', to_char(v_e.entry_date, 'DD/MM/YYYY'), v_y.code using errcode = '23514';
  end if;
  if v_e.source_type <> 'migrated' then
    if v_y.status <> 'open' then
      raise exception 'El ejercicio % está cerrado.', v_y.code using errcode = '23514';
    end if;
    -- C04b (12/10): en un ejercicio con parte traída, Folvy numera DETRÁS del
    -- último número traído en cada serie (el número es max + 1, abajo). Para
    -- eso el histórico tiene que estar dentro antes de validar nada: si no,
    -- el primero de Folvy cogería el 1 y chocaría con el 1 del programa.
    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      raise exception 'Primero hay que traer el histórico de % de %.',
        case lower(v_y.origin_program) when 'diez' then 'Diez' else v_y.origin_program end, v_y.code using errcode = '23514';
    end if;
    if v_y.imported_until is not null and v_e.entry_date <= v_y.imported_until then
      raise exception 'Hasta el % el ejercicio % es traído de %: la fecha abierta más cercana es el %.',
        to_char(v_y.imported_until, 'DD/MM/YYYY'), v_y.code, v_y.origin_program,
        to_char(public.conta_primer_dia_abierto(v_e.company_id, v_y.imported_until + 1), 'DD/MM/YYYY') using errcode = '23514';
    end if;
    if public.conta_mes_cerrado(v_e.company_id, v_e.entry_date) then
      raise exception 'El mes de % está cerrado: la fecha abierta más cercana es el %.',
        to_char(v_e.entry_date, 'MM/YYYY'),
        coalesce(to_char(public.conta_primer_dia_abierto(v_e.company_id, v_e.entry_date), 'DD/MM/YYYY'), 'ninguna') using errcode = '23514';
    end if;

    -- C05 (respuesta 3): un asiento de cierre o de apertura deja a cero (o
    -- repone) las cuentas de IVA y de retenciones; no es una factura ni entra
    -- en el libro registro. Solo él se libra de las dos reglas de IVA y
    -- retención, y solo si lo hizo el generador de cierre: origen closing u
    -- opening, ENLAZADO en fiscal_year_closing a su ejercicio (la apertura, al
    -- cierre del ejercicio anterior) y con la marca del generador en reasons.
    -- Un closing suelto, o hecho a mano, sigue pasando la regla de IVA.
    -- El contraasiento de uno de esos asientos (reabrir el ejercicio los anula)
    -- también: lleva los mismos apuntes al revés. La condición se mira sobre el
    -- asiento ORIGINAL, que en ese momento sigue enlazado.
    v_cierre := exists (
      select 1 from public.journal_entry o
        join public.fiscal_year oy on oy.id = o.fiscal_year_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.source_type in ('closing', 'opening')
         and coalesce(o.reasons, '[]'::jsonb) @> '[{"decision": "cierre-del-ejercicio"}]'::jsonb
         and exists (
           select 1 from public.fiscal_year_closing c
            where c.company_id = o.company_id
              and ((o.source_type = 'closing' and c.fiscal_year_id = o.fiscal_year_id
                    and o.id in (c.regularization_entry_id, c.closing_entry_id))
                or (o.source_type = 'opening' and c.opening_entry_id = o.id
                    and exists (select 1 from public.fiscal_year a
                                 where a.id = c.fiscal_year_id and a.ends_on + 1 = oy.starts_on)))));

    -- Regla 5: IVA coherente. La cuota es el importe del apunte y = base × tipo, al
    -- céntimo, redondeando por factura: un resumen de n facturas admite medio
    -- céntimo por factura (floor(n/2) céntimos), y cualquier apunte, un céntimo
    -- de redondeo (C06b, Julio, 15/10: un ticket de 20,40 € con el IVA dentro da
    -- base 18,55 y cuota 1,85, y 18,55 × 10 % = 1,86; no hay reparto que cuadre).
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null and not v_cierre
          then 'una retención lleva su tipo, su base y su modelo'
        when not l.is_common and l.location_id is null
          then 'falta el local (o marcarlo como común)'
        end as motivo) m
     where l.entry_id = p_entry and m.motivo is not null;
    if v_mal is not null then raise exception 'No se valida: %.', v_mal using errcode = '23514'; end if;
  end if;

  -- Regla 2: número siguiente de su serie en el ejercicio, sin huecos. Huella encadenada.
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || v_e.company_id, 0));
  select coalesce(max(number), 0) + 1 into v_numero from public.journal_entry
   where company_id = v_e.company_id and fiscal_year_id = v_e.fiscal_year_id and series = v_e.series and number is not null;
  select chain_seq, hash into v_seq, v_prev from public.journal_entry
   where company_id = v_e.company_id and chain_seq is not null order by chain_seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;

  update public.journal_entry set number = v_numero, status = 'validado', validated_at = now(), validated_by = auth.uid(),
         validated_by_name = coalesce(p_quien_nombre, public.conta_nombre_actor()), chain_seq = v_seq, prev_hash = v_prev,
         hash = 'pendiente'
   where id = p_entry;
  v_hash := public.journal_huella(v_prev, public.journal_entry_canonico(p_entry));
  -- La huella se escribe en la misma transacción: el disparador deja pasar este
  -- cambio porque el asiento acaba de validarse (journal_entry_inalterable, 0100).
  perform set_config('folvy.journal_huella', p_entry::text, true);
  update public.journal_entry set hash = v_hash where id = p_entry;
  perform set_config('folvy.journal_huella', '', true);
  return jsonb_build_object('id', p_entry, 'serie', v_e.series, 'numero', v_numero, 'huella', v_hash);
end $function$;

-- 2 ----------------------------------------------------------------------------------
create or replace function public.conta_propuesta_ventas_unidad(p_company uuid, p_location uuid, p_dia date, p_canal uuid, p_marca uuid)
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
marca_cta as (
  select m.brand_id, m.papel, a.code from public.conta_ventas_marca m join public.company_account a on a.id = m.company_account_id
   where m.company_id = p_company and a.status is distinct from 'cerrada'
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
nombre_canal as (select case when p_canal is null then 'sin canal' else coalesce((select name from canal where id = p_canal), 'un canal') end as n),
marca_nombre as (select b.id, b.name from public.brand b, emp where b.account_id = emp.account_id),
loc as (select coalesce((select l.name from public.locations l, emp where l.id = p_location and l.account_id = emp.account_id), 'local') as nombre),
ped as (
  select x.* from public.conta_pedidos_del_dia(p_company, p_location, p_dia) with ordinality as x(id, codigo, canal_id, marca_id, propia, estado, total, base, cuota, tipos, ord)
   where x.canal_id is not distinct from p_canal and (p_marca is null or x.marca_id = p_marca)
),
fila as (
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
   where o.propia and o.canal_id is not distinct from p_canal and (p_marca is null or o.marca_id = p_marca)
),
dev2 as (select d.*, d.c_imp - d.c_base as c_cuota, coalesce(d.codigo, d.pedido_id::text) as ref from dev d),
tot as (
  select count(*) as n, coalesce(sum(c_total), 0) as c_total, coalesce(sum(c_base), 0) as c_base, coalesce(sum(c_cuota), 0) as c_cuota,
         bool_or(not trae) as calculada, count(*) filter (where otro) as otro
    from fila2
),
por_marca as (select marca_id, sum(c_base) as c, min(ord) as o from fila2 group by marca_id),
sin_cuenta as (
  select nombre_canal.n as nombre from nombre_canal
   where ((select count(*) from fila2) > 0 or (select count(*) from dev2) > 0)
     and (p_canal is null or (select cuenta from canal where canal.id = p_canal) is null)
),
sin_subcuenta as (  -- marcas sin su 7000000x o su 7080000x, en orden de aparición y sin repetir
  select coalesce((select name from marca_nombre where id = z.marca_id), case when z.marca_id is null then 'sin marca' else 'una marca' end) as nombre, min(z.o) as o
    from (select pm.marca_id, pm.o from por_marca pm
           where pm.marca_id is null or not exists (select 1 from marca_cta mc where mc.brand_id = pm.marca_id and mc.papel = 'ventas')
          union all
          select d.marca_id, 100000000 + d.ord from dev2 d
           where d.marca_id is null or not exists (select 1 from marca_cta mc where mc.brand_id = d.marca_id and mc.papel = 'devoluciones')) z
   group by 1
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
    select 1 as k1, 0 as k2, 0 as k3, jsonb_build_object('cuenta', (select cuenta from canal where canal.id = p_canal), 'debe', round(tot.c_total / 100, 2), 'haber', 0,
             'concepto', 'Cobra ' || nombre_canal.n,
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null) as j
      from tot, nombre_canal where tot.n > 0
    union all
    select 2, pm.o, 0, jsonb_build_object('cuenta', coalesce((select code from marca_cta mc where mc.brand_id = pm.marca_id and mc.papel = 'ventas'), cta.ventas),
             'debe', 0, 'haber', round(pm.c / 100, 2),
             'concepto', 'Ventas ' || coalesce((select name from marca_nombre where id = pm.marca_id), case when pm.marca_id is null then 'sin marca' else 'una marca' end),
             'local_id', p_location, 'comun', false, 'marca_id', pm.marca_id, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null)
      from por_marca pm, cta
    union all
    select 3, 0, 0, jsonb_build_object('cuenta', cta.iva477, 'debe', 0, 'haber', round(tot.c_cuota / 100, 2), 'concepto', 'IVA repercutido ' || tipo.txt || ' %',
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', null,
             'iva', jsonb_build_object('tipo_id', tipo.id, 'base', round(tot.c_base / 100, 2), 'libro', 'issued', 'deducible', null, 'facturas', tot.n), 'retencion', null)
      from tot, cta, tipo where tot.n > 0
    union all
    select 4, d.ord, 1, jsonb_build_object('cuenta', coalesce((select code from marca_cta mc where mc.brand_id = d.marca_id and mc.papel = 'devoluciones'), cta.devoluciones),
             'debe', round(d.c_base / 100, 2), 'haber', 0,
             'concepto', 'Reembolso al cliente · ' || coalesce((select name from marca_nombre where id = d.marca_id), case when d.marca_id is null then 'sin marca' else 'una marca' end)
                         || ' · pedido ' || coalesce(d.ref, 'sin código'),
             'local_id', p_location, 'comun', false, 'marca_id', d.marca_id, 'tercero_id', null, 'documento', d.ref, 'iva', null, 'retencion', null)
      from dev2 d, cta
    union all
    select 4, d.ord, 2, jsonb_build_object('cuenta', cta.iva477, 'debe', round(d.c_cuota / 100, 2), 'haber', 0, 'concepto', trim('IVA del reembolso ' || coalesce(d.ref, '')),
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', d.ref,
             'iva', jsonb_build_object('tipo_id', tipo.id, 'base', round(d.c_base / 100, 2), 'libro', 'issued', 'deducible', null, 'facturas', 1), 'retencion', null)
      from dev2 d, cta, tipo
    union all
    select 4, d.ord, 3, jsonb_build_object('cuenta', (select cuenta from canal where canal.id = p_canal), 'debe', 0, 'haber', round(d.c_imp / 100, 2),
             'concepto', 'Devuelve ' || nombre_canal.n,
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', d.ref, 'iva', null, 'retencion', null)
      from dev2 d, nombre_canal
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
    select 5, jsonb_build_object('decision', 'Fuera: ' || cnt.cedidas || ' pedido' || case when cnt.cedidas = 1 then '' else 's' end || ' de marcas cedidas (' || public.conta_euros_exactos(round(cnt.c_cedidas / 100, 2)) || ')',
             'porque', 'son ventas del socio y su IVA es del socio: entran solo en su liquidación mensual, que comparas con estos tickets',
             'cita', 'Ley 37/1992, art. 11.Dos.15.º') from cnt where cnt.cedidas > 0
    union all
    select 6, jsonb_build_object('decision', 'Fuera: ' || cnt.cancelados || ' cancelado' || case when cnt.cancelados = 1 then '' else 's' end,
             'porque', 'cancelado antes de entregar no es venta') from cnt where cnt.cancelados > 0
    union all  -- los avisos van detrás, como «Mira esto», en el orden del núcleo: otro tipo y después la subcuenta
    select 7, jsonb_build_object('decision', 'Mira esto',
             'porque', tot.otro || ' pedido' || case when tot.otro = 1 then ' trae' else 's traen' end || ' en sus líneas un tipo distinto del ' || tipo.txt || ' %: mira cuáles antes de validar.')
      from tot, tipo where tot.otro > 0
    union all
    select 8, jsonb_build_object('decision', 'Mira esto',
             'porque', (select string_agg(nombre, ', ' order by o) from sin_subcuenta)
                       || case when (select count(*) from sin_subcuenta) = 1 then ' no tiene' else ' no tienen' end
                       || ' su subcuenta de ventas o de reembolsos: va a la general (' || cta.ventas || ' / ' || cta.devoluciones || '). Enlázala antes de validar.')
      from cta where exists (select 1 from sin_subcuenta)
  ) r
),
resumen as (
  select jsonb_build_object(
    'location_id', p_location, 'sales_day', p_dia,
    'unit_key', coalesce(p_canal::text, 'sin-canal') || coalesce(':' || p_marca::text, ''), 'channel_id', p_canal, 'brand_id', p_marca,
    'tickets_count', tot.n, 'total', round(tot.c_total / 100, 2),
    'by_rate', jsonb_build_array(jsonb_build_object('tax_rate_id', tipo.id, 'rate', public.conta_numero_texto(tipo.rate)::numeric, 'base', round(tot.c_base / 100, 2), 'cuota', round(tot.c_cuota / 100, 2), 'calculated', coalesce(tot.calculada, false))),
    'by_channel', case when tot.n > 0 then jsonb_build_array(jsonb_build_object('channel_id', p_canal, 'total', round(tot.c_total / 100, 2))) else '[]'::jsonb end,
    'by_brand', coalesce((select jsonb_agg(jsonb_build_object('brand_id', marca_id, 'base', round(c / 100, 2)) order by o) from por_marca), '[]'),
    'detail_hash', encode(sha256(convert_to(
        coalesce((select string_agg(id::text, '|' order by id::text collate "C") from fila2), '') || '#' || tot.c_total::bigint::text, 'UTF8')), 'hex'),
    'sale_ids', coalesce((select jsonb_agg(id order by id::text collate "C") from fila2), '[]'),
    'base_calculated', coalesce(tot.calculada, false)) as j
  from tot left join tipo on true
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
    jsonb_build_object('sin_propuesta', 'No sé a qué cuenta va lo que cobra ' || (select nombre from sin_cuenta)
      || ': enlaza su 430 en su ficha (Clientes y proveedores › Plataformas).')
  when tot.n > 0 and abs(tot.c_cuota - sign(tot.c_base) * round(abs(tot.c_base * (select rate from tipo)) / 100)) > floor(0.55 * tot.n + 0.5) then
    jsonb_build_object('sin_propuesta', 'La cuota de los tickets (' || public.conta_euros_exactos(round(tot.c_cuota / 100, 2)) || ') se aleja de la base × '
      || (select txt from tipo) || ' % más de medio céntimo por ticket: hay pedidos con otro tipo.')
  else jsonb_build_object(
    'entrada', jsonb_build_object(
      'series', 1, 'fecha', p_dia,
      'concepto', 'Ventas ' || nombre_canal.n || coalesce(' · ' || (select name from marca_nombre where id = p_marca), '') || ' · ' || loc.nombre,
      'source_type', 'sales_day', 'source_id', null,
      'confianza', case when tot.otro > 0 or exists (select 1 from sin_subcuenta) then 'duda' when tot.calculada then 'probable' else 'seguro' end,
      'porque', tot.n || case when tot.n = 1 then ' ticket de tus marcas en ' || nombre_canal.n || ' cuadra' else ' tickets de tus marcas en ' || nombre_canal.n || ' cuadran' end
                || ' con lo que cobra, al céntimo'
                || case when tot.calculada then '; base calculada al ' || (select txt from tipo) || ' %' else '' end || '.',
      'razones', razones.j, 'party_id', null, 'documento', null),
    'lineas', lineas.j,
    'resumen', resumen.j)
  end
from tot, cnt, cta, loc, lineas, razones, resumen, nombre_canal
$$;
