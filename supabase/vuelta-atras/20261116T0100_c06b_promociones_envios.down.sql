-- supabase/vuelta-atras/20261116T0100_c06b_promociones_envios.down.sql
--
-- Vuelta atrás de 20261116T0100_c06b_promociones_envios: las dos funciones como
-- estaban (conta_propuesta_ventas_unidad de la 20261113T0100 y
-- conta_resumen_ventas de la 20261021T0100), copiadas tal cual; y fuera lo que
-- la 0100 añadió: el freno al validar, conta_envio_aclarar,
-- conta_cargos_de_pedidos y sus dos tablas.
-- Antes, la 0110 (datos) tiene que estar deshecha: con enlaces en
-- conta_ventas_canal_cuenta, para sin tocar nada. Y si hay un envío aclarado,
-- también para: es lo que dijo una liquidación y no se tira.
-- No toca ningún asiento: lo validado sigue validado.
-- Y no va sola si está aplicada la tanda de D (20261117T0100,
-- conta_motivos_para_validar): con ella, la validación y el freno llaman a
-- conta_cargos_de_pedidos, que esto quita. Primero se deshace la de D; si
-- conta_motivos_para_validar sigue existiendo, para sin tocar nada.

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'conta_motivos_para_validar') then
    raise exception 'Vuelta atrás C06b 0100: está aplicada la tanda de D (conta_motivos_para_validar), que llama a conta_cargos_de_pedidos. Deshaz antes la 20261117T0100 de D. No se toca nada.';
  end if;
  if exists (select 1 from public.conta_ventas_canal_cuenta) then
    raise exception 'Vuelta atrás C06b 0100: aún hay subcuentas enlazadas (conta_ventas_canal_cuenta). Deshaz antes la 0110. No se toca nada.';
  end if;
  if exists (select 1 from public.conta_envio_aclarado) then
    raise exception 'Vuelta atrás C06b 0100: hay envíos aclarados con su liquidación (conta_envio_aclarado). No se tiran. No se toca nada.';
  end if;
end $$;

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


create or replace function public.conta_resumen_ventas(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_d public.sales_day_summary;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  select * into v_d from public.sales_day_summary
   where entry_id = v_e.id and account_id = v_e.account_id and company_id = v_e.company_id;
  if v_d.id is null or v_d.channel_id is null then
    raise exception 'Ese asiento no es de las ventas de una plataforma: no lleva resumen de ventas.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id,
    'estado', v_e.status, 'serie', v_e.series, 'numero', v_e.number,
    'fecha', v_d.sales_day, 'validado_en', v_e.validated_at,
    'empresa', (select jsonb_build_object('nombre', c.legal_name, 'nif', c.tax_id)
                  from public.company c where c.id = v_e.company_id and c.account_id = v_e.account_id),
    'local', (select jsonb_build_object('id', l.id, 'nombre', l.name)
                from public.locations l where l.id = v_d.location_id and l.account_id = v_e.account_id),
    'canal', (select jsonb_build_object('id', ch.id, 'slug', ch.slug, 'nombre', ch.name)
                from public.sales_channel ch where ch.id = v_d.channel_id and ch.account_id = v_e.account_id),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'hora', to_char(s.sold_at at time zone 'Europe/Madrid', 'HH24:MI'),
               'codigo', coalesce(s.platform_order_code, left(s.id::text, 8)),
               'marca', b.name, 'total', s.total, 'base', s.taxable_base, 'cuota', s.tax) order by s.sold_at, s.id)
        from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
       where s.id = any (v_d.sale_ids) and s.account_id = v_e.account_id), '[]'::jsonb),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cuenta', a.code, 'debe', l.debit, 'haber', l.credit, 'marca', b.name,
               'tipoIva', t.rate, 'documento', l.document_ref) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.brand b on b.id = l.brand_id and b.account_id = v_e.account_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id and l.account_id = v_e.account_id), '[]'::jsonb),
    'documento', (
      select jsonb_build_object('id', x.id, 'ruta', x.storage_path, 'nombre', x.file_name, 'sha256', x.sha256,
                                'bytes', x.size_bytes, 'creado_en', x.created_at, 'creado_por', x.created_by_name)
        from public.journal_entry_document x
       where x.entry_id = v_e.id and x.account_id = v_e.account_id and x.kind = 'resumen_ventas'));
end $$;

drop trigger if exists trg_journal_entry_envio_por_aclarar on public.journal_entry;
drop function if exists public.tg_journal_entry_envio_por_aclarar();
drop function if exists public.conta_envio_aclarar(uuid, text, text, text);
drop function if exists public.conta_cargos_de_pedidos(uuid, uuid[]);
drop table if exists public.conta_envio_aclarado;
drop table if exists public.conta_ventas_canal_cuenta;
