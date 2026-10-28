-- supabase/migrations/20261028T0849_s01_propuestas_pagado_despues.sql
--
-- S01 · PR 3 · Entrega 5 · ORIGEN 3 DE 5: EL PEDIDO NO CONFIRMADO QUE UNA
-- LIQUIDACIÓN PAGA (sales_adjustment, «pagado después»). Se propone solo al
-- leer la liquidación que lo paga (cuando sus pedidos entran o se casan en
-- channel_settlement_order) y en la pasada de noche. Como hoy, no se valida.
--
-- cambia: public.conta_propuesta_ventas_unidad · prueba: supabase/staging/sql/20261028_s01_propuestas_pagado_despues_prueba.sql
-- cambia: public.channel_settlement_order · prueba: supabase/staging/sql/20261028_s01_propuestas_pagado_despues_prueba.sql
--
-- Una sola copia de la regla de ventas. El navegador proponía este asiento con
-- noConfirmadoPagado(), que es ventasDelDia() con ese único pedido; la regla de
-- ventas ya vive en SQL (conta_propuesta_ventas_unidad, la de la pasada que
-- valida las ventas del día). Así que:
--   1. _conta_propuesta_ventas: el cuerpo de conta_propuesta_ventas_unidad, tal
--      cual (el de la C06b, md5 dfd76826… en producción el 28/10), con un
--      parámetro más, p_venta: con él, solo ese pedido, como vendido; sin él,
--      exactamente lo de antes (el mismo texto; solo cambian el «ped» y el «dev»,
--      y los dos con p_venta nulo dan las mismas filas).
--   2. conta_propuesta_ventas_unidad (misma firma) llama a la de arriba sin
--      pedido. Respaldada; su vuelta atrás la deja byte a byte.
--   3. conta_propuesta_pagado_despues(empresa, la fila de
--      conta_no_confirmados_pagados): la regla de noConfirmadoPagado() en SQL
--      puro: las líneas de la venta de su día (con la subcuenta de su marca,
--      la promoción y el envío, como el asiento del día de hoy), y el concepto,
--      el porqué y las razones de siempre.
--   4. conta_proponer_pagados_despues(empresa, quién): los de
--      conta_no_confirmados_pagados con su día abierto; lo que no puede, a «Lo
--      que no he podido proponer» (dónde: Ventas › Cierres del día).
--   5. Los disparadores de channel_settlement_order (al entrar o cambiar sus
--      filas, una vez por sentencia): proponen los de las cuentas tocadas. Si
--      falla, la liquidación entra igual y queda dicho.
--
-- Una diferencia a propósito, medida y dicha en el parte (regla 31): el
-- navegador mandaba la venta a la 700 general y no separaba la promoción ni el
-- envío, porque llamaba a ventasDelDia sin «unidad»; su comentario pedía «las
-- mismas líneas que tendría en el asiento del día», y ése va por plataforma y
-- marca desde la C04b. Ahora las lleva.
--
-- Medido en producción el 28/10, solo lectura: 19 pedidos no confirmados en
-- Foodint, ninguno con línea de liquidación; 0 asientos sales_adjustment.
-- channel_settlement_order: 6.638 filas, la última del 12/07, sin disparadores.

select public._respaldar_funcion('public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)', '20261028T0849_s01_propuestas_pagado_despues');

-- ── 1 · La regla de ventas, una vez, con un pedido opcional ─────────────────
create or replace function public._conta_propuesta_ventas(p_company uuid, p_location uuid, p_dia date, p_canal uuid, p_marca uuid, p_venta uuid)
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
           order by pr.party_id, a.code limit 1) as cuenta,
         (select a.code from public.conta_ventas_canal_cuenta v join public.company_account a on a.id = v.company_account_id and a.company_id = v.company_id
           where v.company_id = p_company and v.channel_id = ch.id and v.papel = 'promociones' and a.status is distinct from 'cerrada') as promo,
         (select a.code from public.conta_ventas_canal_cuenta v join public.company_account a on a.id = v.company_account_id and a.company_id = v.company_id
           where v.company_id = p_company and v.channel_id = ch.id and v.papel = 'envios' and a.status is distinct from 'cerrada') as envios
    from public.sales_channel ch, emp where ch.account_id = emp.account_id
),
cta_canal as (select (select promo from canal where id = p_canal) as promo, (select envios from canal where id = p_canal) as envios),
nombre_canal as (select case when p_canal is null then 'sin canal' else coalesce((select name from canal where id = p_canal), 'un canal') end as n),
marca_nombre as (select b.id, b.name from public.brand b, emp where b.account_id = emp.account_id),
loc as (select coalesce((select l.name from public.locations l, emp where l.id = p_location and l.account_id = emp.account_id), 'local') as nombre),
ped as (
  -- S01 · PR 3: con p_venta, solo ese pedido, como vendido de una marca propia (el
  -- no confirmado que una liquidación paga es venta de su día). Sin él, como siempre.
  select x.id, x.codigo, x.canal_id, x.marca_id,
         case when p_venta is null then x.propia else true end as propia,
         case when p_venta is null then x.estado else 'closed' end as estado,
         x.total, x.base, x.cuota, x.tipos, x.ord
    from public.conta_pedidos_del_dia(p_company, p_location, p_dia) with ordinality as x(id, codigo, canal_id, marca_id, propia, estado, total, base, cuota, tipos, ord)
   where x.canal_id is not distinct from p_canal and (p_marca is null or x.marca_id = p_marca)
     and (p_venta is null or x.id = p_venta)
),
-- C06b (16/10): el descuento, el envío y quién repartió cada pedido (conta_cargos_de_pedidos).
carg as (
  select c.* from emp, public.conta_cargos_de_pedidos(emp.account_id, (select coalesce(array_agg(id), '{}') from ped where propia and estado = 'closed')) c
),
fila0 as (
  select p.*, round(coalesce(c.descuento, 0) * 100) as c_desc, round(coalesce(c.envio, 0) * 100) as c_env,
         coalesce(c.clase, 'ninguno') as clase, c.por_que,
         -- Un envío que la plataforma no paga (aclarado así) sale de la venta y del cobro.
         round(p.total * 100) - case when c.clase = 'fuera' then round(c.envio * 100) else 0 end as c_total
    from ped p left join carg c on c.id = p.id
   where p.propia and p.estado = 'closed'
),
fila as (
  select p.*,
         (p.clase <> 'fuera' and p.base is not null and p.cuota is not null and round(p.base * 100) + round(p.cuota * 100) = round(p.total * 100)) as trae,
         exists (select 1 from unnest(p.tipos) t where t <> tipo.rate) as otro,
         case when p.clase <> 'fuera' and p.base is not null and p.cuota is not null and round(p.base * 100) + round(p.cuota * 100) = round(p.total * 100)
              then round(p.base * 100)
              else sign(p.c_total) * round(abs(p.c_total) * 100 / (100 + tipo.rate)) end as c_base
    from fila0 p, tipo
),
fila2 as (
  select f.*, case when f.trae then round(f.cuota * 100) else f.c_total - f.c_base end as c_cuota,
         -- La promoción en base, al tipo de la venta; el envío cobrado, igual. Sin su subcuenta, se quedan en la venta (y se avisa).
         case when cc.promo is not null and f.c_desc > 0 then round(f.c_desc * 100 / (100 + tipo.rate)) else 0 end as c_promo,
         case when cc.envios is not null and f.clase = 'cobrado' and f.c_env > 0 then round(f.c_env * 100 / (100 + tipo.rate)) else 0 end as c_envio
    from fila f, tipo, cta_canal cc
),
dev as (
  select o.*, round(o.importe * 100) as c_imp,
         sign(o.importe) * round(abs(round(o.importe * 100)) * 100 / (100 + tipo.rate)) as c_base
    from public.conta_devoluciones_del_dia(p_company, p_location, p_dia) with ordinality as o(pedido_id, codigo, canal_id, marca_id, propia, importe, ord), tipo
   where o.propia and o.canal_id is not distinct from p_canal and (p_marca is null or o.marca_id = p_marca)
     and p_venta is null
),
dev2 as (select d.*, d.c_imp - d.c_base as c_cuota, coalesce(d.codigo, d.pedido_id::text) as ref from dev d),
tot as (
  select count(*) as n, coalesce(sum(c_total), 0) as c_total, coalesce(sum(c_base), 0) as c_base, coalesce(sum(c_cuota), 0) as c_cuota,
         bool_or(not trae) as calculada, count(*) filter (where otro) as otro,
         coalesce(sum(c_promo), 0) as c_promo, count(*) filter (where c_promo > 0) as n_promo, coalesce(sum(c_desc) filter (where c_promo > 0), 0) as c_desc,
         count(*) filter (where c_desc > 0 and c_promo = 0) as n_promo_sin_cuenta,
         coalesce(sum(c_envio), 0) as c_envio, count(*) filter (where c_envio > 0) as n_envio, coalesce(sum(c_env) filter (where c_envio > 0), 0) as c_env,
         count(*) filter (where clase = 'cobrado' and c_env > 0 and c_envio = 0) as n_envio_sin_cuenta,
         count(*) filter (where clase = 'por_aclarar') as n_aclarar,
         count(*) filter (where clase = 'fuera') as n_fuera, coalesce(sum(c_env) filter (where clase = 'fuera'), 0) as c_fuera
    from fila2
),
-- La venta de cada marca, a precio de carta: lo pagado + su promoción − el envío cobrado.
por_marca as (select marca_id, sum(c_base + c_promo - c_envio) as c, min(ord) as o from fila2 group by marca_id),
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
    select 2, -1, 0, jsonb_build_object('cuenta', cc.promo, 'debe', round(tot.c_promo / 100, 2), 'haber', 0,
             'concepto', 'Promociones ' || nombre_canal.n || ' · ' || tot.n_promo || ' pedido' || case when tot.n_promo = 1 then '' else 's' end,
             'local_id', p_location, 'comun', false, 'marca_id', p_marca, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null)
      from tot, cta_canal cc, nombre_canal where tot.c_promo > 0
    union all
    select 2, 1000000000, 0, jsonb_build_object('cuenta', cc.envios, 'debe', 0, 'haber', round(tot.c_envio / 100, 2),
             'concepto', 'Envíos cobrados · ' || tot.n_envio || ' pedido' || case when tot.n_envio = 1 then '' else 's' end,
             'local_id', p_location, 'comun', false, 'marca_id', p_marca, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null)
      from tot, cta_canal cc where tot.c_envio > 0
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
    select 2.1, jsonb_build_object('decision', 'Promociones: ' || tot.n_promo || ' pedido' || case when tot.n_promo = 1 then '' else 's' end
               || ', ' || public.conta_euros_exactos(round(tot.c_desc / 100, 2)) || ' con el IVA dentro',
             'porque', 'la venta va a precio de carta en su marca y la promoción, en su subcuenta (' || cc.promo || '), resta; el IVA va sobre lo que paga el cliente',
             'cita', 'Ley 37/1992, art. 78.Tres.2.º') from tot, cta_canal cc where tot.c_promo > 0
    union all
    select 2.2, jsonb_build_object('decision', 'Envíos cobrados: ' || tot.n_envio || ' pedido' || case when tot.n_envio = 1 then '' else 's' end
               || ', ' || public.conta_euros_exactos(round(tot.c_env / 100, 2)) || ' con el IVA dentro',
             'porque', 'lo repartimos nosotros: el envío es del restaurante y va a su subcuenta (' || cc.envios || '), con su local; forma parte de la base, al tipo de la venta',
             'cita', 'Ley 37/1992, art. 78.Dos.1.º') from tot, cta_canal cc where tot.c_envio > 0
    union all
    select 2.3, jsonb_build_object('decision', 'Fuera: el envío de ' || tot.n_fuera || ' pedido' || case when tot.n_fuera = 1 then '' else 's' end
               || ' (' || public.conta_euros_exactos(round(tot.c_fuera / 100, 2)) || ')',
             'porque', 'lo repartió la plataforma y su liquidación no lo paga: no es venta del restaurante ni lo cobra la plataforma para él') from tot where tot.n_fuera > 0
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
    union all
    select 9, jsonb_build_object('decision', 'Mira esto',
             'porque', 'Por aclarar: ' || tot.n_aclarar || ' pedido' || case when tot.n_aclarar = 1 then '' else 's' end || ' con envío y sin saber si es del restaurante ('
                       || (select string_agg(coalesce(f.codigo, left(f.id::text, 8)) || ' · ' || coalesce((select name from marca_nombre where id = f.marca_id), 'sin marca')
                                             || ' · envío ' || public.conta_euros_exactos(round(f.c_env / 100.0, 2)) || ' · ' || coalesce(f.por_que, 'sin decir quién repartió'), '; ' order by f.ord)
                             from fila2 f where f.clase = 'por_aclarar')
                       || '). Se resuelve con la liquidación de esa semana: si la plataforma lo paga, va a Envíos cobrados; si no, sale de la venta y del cobro. Hasta entonces no se valida.')
      from tot where tot.n_aclarar > 0
    union all
    select 10, jsonb_build_object('decision', 'Mira esto',
             'porque', tot.n_promo_sin_cuenta || ' pedido' || case when tot.n_promo_sin_cuenta = 1 then ' lleva' else 's llevan' end || ' promoción y ' || nombre_canal.n
                       || ' no tiene su subcuenta de promociones: queda restada de la venta. Enlázala antes de validar.')
      from tot, nombre_canal where tot.n_promo_sin_cuenta > 0
    union all
    select 11, jsonb_build_object('decision', 'Mira esto',
             'porque', tot.n_envio_sin_cuenta || ' pedido' || case when tot.n_envio_sin_cuenta = 1 then ' lleva' else 's llevan' end || ' envío cobrado y ' || nombre_canal.n
                       || ' no tiene su subcuenta de envíos: queda dentro de la venta. Enlázala antes de validar.')
      from tot, nombre_canal where tot.n_envio_sin_cuenta > 0
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
      'confianza', case when tot.otro > 0 or exists (select 1 from sin_subcuenta) or tot.n_aclarar > 0 or tot.n_promo_sin_cuenta > 0 or tot.n_envio_sin_cuenta > 0 then 'duda'
                        when tot.calculada then 'probable' else 'seguro' end,
      'porque', tot.n || case when tot.n = 1 then ' ticket de tus marcas en ' || nombre_canal.n || ' cuadra' else ' tickets de tus marcas en ' || nombre_canal.n || ' cuadran' end
                || ' con lo que cobra, al céntimo'
                || case when tot.calculada then '; base calculada al ' || (select txt from tipo) || ' %' else '' end || '.',
      'razones', razones.j, 'party_id', null, 'documento', null),
    'lineas', lineas.j,
    'resumen', resumen.j)
  end
from tot, cnt, cta, loc, lineas, razones, resumen, nombre_canal
$$;
comment on function public._conta_propuesta_ventas(uuid, uuid, date, uuid, uuid, uuid) is
  'S01 · PR 3: la propuesta de ventas de una unidad (plataforma y marca) de un día y local; con p_venta, solo ese pedido como vendido (lo que una liquidación paga después). La única copia de la regla de ventas en la base.';
revoke all on function public._conta_propuesta_ventas(uuid, uuid, date, uuid, uuid, uuid) from public, anon, authenticated;

-- ── 2 · La de siempre, con su firma, llama a la de arriba ──────────────────
create or replace function public.conta_propuesta_ventas_unidad(p_company uuid, p_location uuid, p_dia date, p_canal uuid, p_marca uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public._conta_propuesta_ventas(p_company, p_location, p_dia, p_canal, p_marca, null)
$$;

-- ── 3 · La regla del pagado después ─────────────────────────────────────────
create or replace function public.conta_propuesta_pagado_despues(p_company uuid, p_pago jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with x as (
    select (p_pago->>'sale_id')::uuid as id, (p_pago->>'location_id')::uuid as loc, (p_pago->>'dia')::date as dia,
           p_pago->>'codigo' as codigo, (p_pago->>'canal_id')::uuid as canal, (p_pago->>'marca_id')::uuid as marca,
           p_pago->>'settlement_ref' as ref, (p_pago->>'settlement_date')::date as fecha_liq,
           coalesce((p_pago->>'dia_validado')::boolean, false) as validado
  ), n as (
    select x.*, coalesce(x.codigo, 'sin código') as cod,
           case when x.canal is null then 'sin canal'
                else coalesce((select ch.name from public.sales_channel ch join public.company c on c.account_id = ch.account_id
                                where ch.id = x.canal and c.id = p_company), 'un canal') end as canal_n,
           extract(day from x.dia)::int || ' de ' || (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])[extract(month from x.dia)::int] as dia_n,
           case when x.ref is not null then 'la liquidación ' || x.ref
                  || coalesce(' del ' || extract(day from x.fecha_liq)::int || ' de ' || (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])[extract(month from x.fecha_liq)::int], '')
                else 'su liquidación' end as liq,
           'Pedido ' || coalesce(x.codigo, 'sin código') || ' del ' || to_char(x.dia, 'DD/MM/YYYY') || ', pagado después' as que,
           exists (select 1 from public.conta_pedidos_del_dia(p_company, x.loc, x.dia) d where d.id = x.id) as esta
      from x
  ), v as (
    select n.*, case when n.esta then public._conta_propuesta_ventas(p_company, n.loc, n.dia, n.canal, n.marca, n.id) end as j from n
  )
  select case
    when v.id is null then jsonb_build_object('que', 'Pedido pagado después', 'sin_propuesta', 'No existe.')
    when not v.esta then jsonb_build_object('que', v.que, 'sin_propuesta', 'No encuentro el pedido en su día: puede que ya no esté activo.')
    when v.j ? 'sin_propuesta' then jsonb_build_object('que', v.que, 'sin_propuesta', v.j->>'sin_propuesta')
    else jsonb_build_object('que', v.que, 'propuesta', jsonb_build_object(
      'entrada', (v.j->'entrada') || jsonb_build_object(
        'concepto', 'Venta del ' || v.dia_n || ' pagada después · ' || v.canal_n || ' · pedido ' || v.cod,
        'source_type', 'sales_adjustment', 'source_id', v.id, 'documento', v.codigo,
        'porque', v.canal_n || ' ha pagado el pedido ' || v.cod || ', que se cerró sin confirmar el ' || v.dia_n,
        'razones', jsonb_build_array(
            jsonb_build_object('decision', 'Es venta de su día',
              'porque', 'al cierre del día seguía abierto y se cerró como no confirmado; ' || v.liq || ' lo paga, y la liquidación de la plataforma tiene la última palabra'),
            jsonb_build_object('decision', case when v.validado then 'Va aparte del asiento del día, que está validado y no se toca' else 'Va aparte del asiento del día' end,
              'porque', 'ese pedido no está en el asiento del día, así que no puede contarse dos veces'))
          || coalesce((select jsonb_agg(r order by o) from jsonb_array_elements(v.j->'entrada'->'razones') with ordinality t(r, o)
                        where not (r->>'decision' ~ '^[0-9]+ tickets? de tus marcas')), '[]'::jsonb)),
      'lineas', v.j->'lineas'))
    end
  from (select 1) uno left join v on true
$$;
comment on function public.conta_propuesta_pagado_despues(uuid, jsonb) is
  'S01 · PR 3: la regla del no confirmado que una liquidación paga (noConfirmadoPagado() del navegador), en SQL puro, sobre la regla de ventas (_conta_propuesta_ventas con ese pedido): {que, propuesta} como aJson, o {que, sin_propuesta}. Solo lee.';
revoke all on function public.conta_propuesta_pagado_despues(uuid, jsonb) from public, anon, authenticated;

-- ── 4 · Proponerlos ─────────────────────────────────────────────────────────
create or replace function public.conta_proponer_pagados_despues(p_company uuid, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; r record; x jsonb; v_res jsonb;
        v_prop int := 0; v_ya int := 0; v_desc int := 0; v_sin jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone asientos.' using errcode = '42501';
  end if;
  -- Sin rango: el pago llega después; solo lo que cae en un día abierto (como el navegador).
  for r in select * from public.conta_no_confirmados_pagados(p_company) loop
    continue when r.location_id is null or not public.conta_dia_abierto(p_company, r.dia);
    x := public.conta_propuesta_pagado_despues(p_company, to_jsonb(r));
    if x ? 'sin_propuesta' then
      perform public._conta_no_propuesta(p_company, 'sales_adjustment', r.sale_id::text, x->>'que', x->>'sin_propuesta', 'Ventas › Cierres del día');
      v_sin := v_sin || jsonb_build_array(jsonb_build_object('que', x->>'que', 'porque', x->>'sin_propuesta'));
      continue;
    end if;
    v_res := public._conta_proponer(p_company, x->'propuesta', p_quien);
    if (v_res->>'descartada')::boolean then v_desc := v_desc + 1;
    elsif (v_res->>'existente')::boolean then v_ya := v_ya + 1;
    else v_prop := v_prop + 1; end if;
  end loop;
  return jsonb_build_object('propuestas', v_prop, 'yaEstaban', v_ya, 'descartadas', v_desc, 'sinPropuesta', v_sin);
end $$;
revoke all on function public.conta_proponer_pagados_despues(uuid, text) from public, anon;
grant execute on function public.conta_proponer_pagados_despues(uuid, text) to authenticated, service_role;
comment on function public.conta_proponer_pagados_despues(uuid, text) is
  'S01 · PR 3: propone los no confirmados que una liquidación paga, con su día abierto (navegador, pasada de noche, al leer la liquidación); lo que no puede, a conta_propuesta_pendiente (Ventas › Cierres del día). No valida.';

-- ── 5 · Al leer la liquidación que lo paga ─────────────────────────────────
-- Una vez por sentencia (una carga mete miles de filas): las empresas de las
-- cuentas con algún pedido casado y pagado en lo que entra. Si falla, la
-- liquidación entra igual, queda dicho por pedido, y la pasada de noche lo repite.
create or replace function public.tg_conta_liquidacion_pedidos_proponer()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record; s record;
begin
  for c in select distinct co.id from public.company co
            where co.is_active and co.account_id in (select n.account_id from nuevas n
                                                      where n.sale_id is not null and coalesce(n.matched, false) and coalesce(n.products, 0) > 0) loop
    begin
      perform public.conta_proponer_pagados_despues(c.id, 'Sumied (al leer la liquidación)');
    exception when others then
      for s in select distinct n.sale_id from nuevas n join public.company co on co.id = c.id and co.account_id = n.account_id
                where n.sale_id is not null and coalesce(n.matched, false) and coalesce(n.products, 0) > 0 loop
        perform public._conta_no_propuesta(c.id, 'sales_adjustment', s.sale_id::text, 'Pedido pagado después',
          'No he podido proponerlo al leer la liquidación: ' || sqlerrm, 'Ventas › Cierres del día');
      end loop;
    end;
  end loop;
  return null;
end $$;
revoke all on function public.tg_conta_liquidacion_pedidos_proponer() from public, anon, authenticated;
drop trigger if exists conta_liquidacion_pedidos_proponer_al_entrar on public.channel_settlement_order;
create trigger conta_liquidacion_pedidos_proponer_al_entrar after insert on public.channel_settlement_order
  referencing new table as nuevas for each statement execute function public.tg_conta_liquidacion_pedidos_proponer();
drop trigger if exists conta_liquidacion_pedidos_proponer_al_casar on public.channel_settlement_order;
create trigger conta_liquidacion_pedidos_proponer_al_casar after update on public.channel_settlement_order
  referencing new table as nuevas for each statement execute function public.tg_conta_liquidacion_pedidos_proponer();
