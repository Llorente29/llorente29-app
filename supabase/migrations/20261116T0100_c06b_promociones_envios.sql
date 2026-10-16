-- supabase/migrations/20261116T0100_c06b_promociones_envios.sql
--
-- cambia: public.conta_propuesta_ventas_unidad · prueba: supabase/staging/sql/20261116_c06b_promociones_envios_prueba.sql
-- cambia: public.conta_resumen_ventas · prueba: supabase/staging/sql/20261116_c06b_promociones_envios_prueba.sql
--
-- C06b · Las promociones y los envíos en el asiento de ventas del día (diseño
-- aprobado por Julio el 16/10, en CONTEXTO_CLAUDE.md, «DISEÑO: las promociones
-- en el asiento de ventas del día» y «La construcción»).
--
-- LO QUE AÑADE:
--   1. conta_ventas_canal_cuenta: la subcuenta de PROMOCIONES (7000900x) y la de
--      ENVÍOS COBRADOS (70500001) de cada plataforma, por empresa. Sin fila, la
--      promoción se queda restada de la venta y el envío dentro de ella, como
--      hasta hoy, y el asiento sale en «duda» con su «Mira esto».
--   2. conta_envio_aclarado: lo que se sabe, por la liquidación de su semana,
--      del envío de un pedido que repartió la plataforma: «lo_paga» (va a
--      Envíos cobrados) o «no_lo_paga» (sale de la venta y del cobro).
--   3. conta_cargos_de_pedidos(cuenta, pedidos): de cada pedido, su descuento
--      (sale.discount_amount, de HubRise discounts[].price_off, con el IVA
--      dentro), su envío (raw_tab.charges de tipo «delivery», con el IVA
--      dentro), quién repartió (sale.service_type, lo que se guardó al entrar
--      el pedido) y qué se hace con el envío: ninguno, cobrado, por_aclarar o
--      fuera. Un «plataforma» por defecto de resolve_delivery_by no vale para
--      la contabilidad: va a por_aclarar.
--   4. conta_envio_aclarar(pedido, decisión, motivo): apunta lo que dijo la
--      liquidación y quita el asiento PROPUESTO de ese día (no el validado):
--      el siguiente cierre del día lo vuelve a proponer con lo aclarado.
--   5. Un freno al validar (disparador en journal_entry): un asiento de ventas
--      del día con un envío por aclarar no se valida. Lo validado no pasa por
--      él (solo el paso a «validado»).
--
-- LO QUE CAMBIA (misma firma: create or replace no hace sobrecarga):
--   6. conta_propuesta_ventas_unidad: la venta de cada marca a precio de carta
--      (lo pagado + su promoción − su envío cobrado), la promoción al DEBE en la
--      subcuenta de su plataforma, el envío cobrado al HABER en la 70500001 con
--      su local, el IVA sobre lo que paga el cliente (como hoy: la 430 y la 477
--      no cambian). La promoción y el envío en base, pedido a pedido, al tipo
--      de la venta y al céntimo; la venta de la marca es la diferencia, así que
--      el asiento cuadra siempre. El pedido pequeño se queda en la venta. Lo
--      demás, copiado de la vigente (20261113T0100, la misma huella en
--      producción).
--   7. conta_resumen_ventas: cada pedido lleva su descuento, su envío y su
--      clase; cada línea, su papel (promociones o envíos). Con eso el PDF y la
--      factura de Diez salen iguales que el asiento. Lo demás, copiado de la
--      vigente (20261021T0100).
--
-- Solo para lo que entre desde ahora: los asientos validados (los 59 de
-- octubre) no se tocan, y nada de esto tiene fecha anterior al 01/10/2026
-- (la contabilidad está cerrada a 30/09; lo para la validación).
-- Ninguna está en el camino del pedido: el cierre del día y el Libro leen.
-- Vuelta atrás: supabase/vuelta-atras/20261116T0100_c06b_promociones_envios.down.sql

-- 1 ----------------------------------------------------------------------------------
create table if not exists public.conta_ventas_canal_cuenta (
  company_id          uuid not null references public.company(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,
  channel_id          uuid not null references public.sales_channel(id) on delete cascade,
  papel               text not null check (papel in ('promociones', 'envios')),
  company_account_id  uuid not null references public.company_account(id) on delete restrict,
  created_at          timestamptz not null default now(),
  created_by_name     text,
  primary key (company_id, channel_id, papel)
);
comment on table public.conta_ventas_canal_cuenta is
  'C06b (16/10): la subcuenta de promociones (7000900x, resta) y la de envíos cobrados (70500001) de cada plataforma, por empresa. La leen la propuesta de ventas del día, su resumen y la factura de Diez.';
alter table public.conta_ventas_canal_cuenta enable row level security;
drop policy if exists conta_ventas_canal_cuenta_select on public.conta_ventas_canal_cuenta;
create policy conta_ventas_canal_cuenta_select on public.conta_ventas_canal_cuenta for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
-- Sin políticas de escritura: la escribe una migración hasta que haya pantalla.
revoke all on table public.conta_ventas_canal_cuenta from anon;
drop trigger if exists trg_conta_ventas_canal_cuenta_misma_cuenta on public.conta_ventas_canal_cuenta;
create trigger trg_conta_ventas_canal_cuenta_misma_cuenta before insert or update on public.conta_ventas_canal_cuenta
  for each row execute function public.conta_misma_cuenta();

-- 2 ----------------------------------------------------------------------------------
create table if not exists public.conta_envio_aclarado (
  sale_id          uuid primary key references public.sale(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  decision         text not null check (decision in ('lo_paga', 'no_lo_paga')),
  motivo           text not null check (length(trim(motivo)) > 0),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text
);
comment on table public.conta_envio_aclarado is
  'C06b (16/10): el envío de un pedido que repartió la plataforma, aclarado con la liquidación de su semana. lo_paga: va a Envíos cobrados; no_lo_paga: sale de la venta y del cobro. Lo escribe conta_envio_aclarar.';
alter table public.conta_envio_aclarado enable row level security;
drop policy if exists conta_envio_aclarado_select on public.conta_envio_aclarado;
create policy conta_envio_aclarado_select on public.conta_envio_aclarado for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
revoke all on table public.conta_envio_aclarado from anon;
drop trigger if exists trg_conta_envio_aclarado_misma_cuenta on public.conta_envio_aclarado;
create trigger trg_conta_envio_aclarado_misma_cuenta before insert or update on public.conta_envio_aclarado
  for each row execute function public.conta_misma_cuenta();
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  grant select on table public.conta_ventas_canal_cuenta, public.conta_envio_aclarado to conta_lectura;
end $$;

-- 3 ----------------------------------------------------------------------------------
-- Con los permisos de quien llama (sin security definer): desde el Libro, solo
-- los pedidos de su cuenta; desde el cierre del día, los de la empresa.
create or replace function public.conta_cargos_de_pedidos(p_account uuid, p_sales uuid[])
returns table (id uuid, descuento numeric, envio numeric, reparto text, clase text, por_que text)
language sql stable set search_path = public as $$
  select s.id,
         greatest(coalesce(s.discount_amount, 0), 0),
         x.envio,
         s.service_type,
         case when x.envio = 0 then 'ninguno'
              when a.decision = 'lo_paga' then 'cobrado'
              when a.decision = 'no_lo_paga' then 'fuera'
              when s.service_type = 'own_delivery' and coalesce(r.source, '') <> 'default' then 'cobrado'
              else 'por_aclarar' end,
         case when x.envio = 0 or a.decision is not null then null
              when s.service_type = 'own_delivery' and coalesce(r.source, '') <> 'default' then null
              when s.service_type = 'own_delivery' then 'quién reparte está por defecto (nadie lo ha dicho)'
              when s.service_type = 'platform_delivery' then 'repartió la plataforma'
              when s.service_type = 'pickup' then 'el pedido es de recogida'
              else 'sin decir quién repartió' end
    from public.sale s
    cross join lateral (
      select coalesce(sum(split_part(c->>'price', ' ', 1)::numeric), 0) as envio
        from jsonb_array_elements(case when jsonb_typeof(public.conta_json_seguro(s.raw_tab)->'charges') = 'array'
                                       then public.conta_json_seguro(s.raw_tab)->'charges' else '[]'::jsonb end) c
       where c->>'type' = 'delivery' and coalesce(c->>'deleted', 'false') <> 'true'
         and split_part(c->>'price', ' ', 1) ~ '^[0-9]+(\.[0-9]+)?$'
    ) x
    left join public.conta_envio_aclarado a on a.sale_id = s.id and a.account_id = s.account_id
    left join lateral (
      select d.source from public.sales_channel ch, public.resolve_delivery_by(s.account_id, s.brand_id, ch.slug, s.location_id) d
       where ch.id = s.channel_id and ch.account_id = s.account_id and x.envio > 0 and s.service_type = 'own_delivery'
    ) r on true
   where s.account_id = p_account and s.id = any (p_sales)
$$;
comment on function public.conta_cargos_de_pedidos(uuid, uuid[]) is
  'C06b (16/10): de cada pedido, su descuento y su envío (con el IVA dentro), quién repartió (lo guardado al entrar) y qué se hace con el envío: ninguno, cobrado (va a Envíos cobrados), por_aclarar (no se sabe si es del restaurante) o fuera (la plataforma no lo paga).';
revoke all on function public.conta_cargos_de_pedidos(uuid, uuid[]) from public, anon;
grant execute on function public.conta_cargos_de_pedidos(uuid, uuid[]) to authenticated;

-- 4 ----------------------------------------------------------------------------------
create or replace function public.conta_envio_aclarar(p_sale uuid, p_decision text, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s public.sale; v_e record; v_n int := 0; v_codigo text; v_empresa uuid;
begin
  select * into v_s from public.sale where id = p_sale;
  if v_s.id is null or not public.belongs_to_account(v_s.account_id) then raise exception 'Ese pedido no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_s.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta aclara un envío.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('lo_paga', 'no_lo_paga') then
    raise exception 'Lo que dice la liquidación es «lo_paga» o «no_lo_paga».' using errcode = '22023';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then raise exception 'Para aclarar un envío hay que decir de dónde sale (la liquidación).' using errcode = '23514'; end if;
  v_codigo := coalesce(v_s.platform_order_code, left(v_s.id::text, 8));
  -- Lo validado no se cambia aquí: se ajusta con su liquidación.
  for v_e in
    select e.id, e.status, e.company_id from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id and e.account_id = d.account_id
     where d.account_id = v_s.account_id and p_sale = any (d.sale_ids) and e.status not in ('anulado')
  loop
    if v_e.status = 'validado' then
      raise exception 'El pedido % está en un asiento ya validado: no se cambia aquí, se ajusta con su liquidación.', v_codigo using errcode = '23514';
    end if;
    v_empresa := v_e.company_id;
    delete from public.journal_entry where id = v_e.id and status in ('propuesto', 'borrador');
    get diagnostics v_n = row_count;
  end loop;
  if v_empresa is null then
    select c.id into v_empresa from public.company c where c.account_id = v_s.account_id order by c.created_at limit 1;
  end if;
  insert into public.conta_envio_aclarado (sale_id, account_id, company_id, decision, motivo, created_by, created_by_name)
  values (v_s.id, v_s.account_id, v_empresa, p_decision, trim(p_motivo), auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  on conflict (sale_id) do update set decision = excluded.decision, motivo = excluded.motivo, created_at = now(),
    created_by = excluded.created_by, created_by_name = excluded.created_by_name;
  return jsonb_build_object('pedido', v_codigo, 'decision', p_decision, 'quitado', v_n > 0,
    'texto', 'Aclarado: el envío del pedido ' || v_codigo || case when p_decision = 'lo_paga' then ' lo paga la plataforma y va a Envíos cobrados.' else ' no lo paga la plataforma: sale de la venta y del cobro.' end
             || case when v_n > 0 then ' El asiento propuesto de ese día se ha quitado: el cierre del día lo vuelve a proponer (cada hora, a los 7 minutos).' else '' end);
end $$;
comment on function public.conta_envio_aclarar(uuid, text, text, text) is
  'C06b (16/10): apunta lo que dice la liquidación del envío de un pedido (lo_paga / no_lo_paga) y quita el asiento propuesto de su día para que el cierre lo vuelva a proponer. Lo validado no se toca.';
revoke all on function public.conta_envio_aclarar(uuid, text, text, text) from public, anon;
grant execute on function public.conta_envio_aclarar(uuid, text, text, text) to authenticated;

-- 5 ----------------------------------------------------------------------------------
create or replace function public.tg_journal_entry_envio_por_aclarar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int; v_lista text;
begin
  select count(*), string_agg(coalesce(s.platform_order_code, left(s.id::text, 8)) || ' (envío ' || public.conta_euros_exactos(c.envio) || ', ' || c.por_que || ')', '; ' order by s.sold_at)
    into v_n, v_lista
    from public.sales_day_summary d
    cross join lateral public.conta_cargos_de_pedidos(d.account_id, d.sale_ids) c
    join public.sale s on s.id = c.id and s.account_id = d.account_id
   where d.entry_id = new.id and d.account_id = new.account_id and c.clase = 'por_aclarar';
  if v_n > 0 then
    raise exception 'No se valida: % con envío por aclarar: %. Se resuelve con la liquidación de esa semana.',
      v_n || case when v_n = 1 then ' pedido' else ' pedidos' end, v_lista using errcode = '23514';
  end if;
  return new;
end $$;
comment on function public.tg_journal_entry_envio_por_aclarar() is
  'C06b (16/10): un asiento de ventas del día con un envío por aclarar (no se sabe si es del restaurante) no pasa a validado.';
drop trigger if exists trg_journal_entry_envio_por_aclarar on public.journal_entry;
create trigger trg_journal_entry_envio_por_aclarar before update of status on public.journal_entry
  for each row when (new.status = 'validado' and old.status is distinct from 'validado' and new.source_type = 'sales_day')
  execute function public.tg_journal_entry_envio_por_aclarar();

-- 6 ----------------------------------------------------------------------------------
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
  select x.* from public.conta_pedidos_del_dia(p_company, p_location, p_dia) with ordinality as x(id, codigo, canal_id, marca_id, propia, estado, total, base, cuota, tipos, ord)
   where x.canal_id is not distinct from p_canal and (p_marca is null or x.marca_id = p_marca)
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


-- 7 ----------------------------------------------------------------------------------
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
               'marca', b.name, 'total', s.total, 'base', s.taxable_base, 'cuota', s.tax,
               -- C06b (16/10): el descuento y el envío, y qué se hizo con el envío (conta_cargos_de_pedidos).
               'descuento', coalesce(c.descuento, 0), 'envio', coalesce(c.envio, 0), 'clase', coalesce(c.clase, 'ninguno')) order by s.sold_at, s.id)
        from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
        left join public.conta_cargos_de_pedidos(v_e.account_id, v_d.sale_ids) c on c.id = s.id
       where s.id = any (v_d.sale_ids) and s.account_id = v_e.account_id), '[]'::jsonb),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cuenta', a.code, 'debe', l.debit, 'haber', l.credit, 'marca', b.name,
               'tipoIva', t.rate, 'documento', l.document_ref,
               -- C06b (16/10): si la línea es la de promociones o la de envíos de su plataforma.
               'papel', (select v.papel from public.conta_ventas_canal_cuenta v
                          where v.company_id = v_e.company_id and v.channel_id = v_d.channel_id and v.company_account_id = a.id)) order by l.position)
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
