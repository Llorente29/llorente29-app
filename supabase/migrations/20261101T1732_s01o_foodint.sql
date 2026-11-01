-- supabase/migrations/20261101T1732_s01o_foodint.sql
--
-- S01o · Foodint (Julio, 01/11, decisiones 1, 2 y 4 y la respuesta 2):
--   1. La ficha de cada plataforma, con su cuenta de gasto y de publicidad, las
--      que Foodint ya usa en su historia: Glovo 62300001 (toda su factura,
--      también Glovo Ads); Uber 62300002 y 62700002; Just Eat 62300003 y 62700003.
--   2. «Apuntar solo lo que Sumied tiene seguro», encendido en Foodint.
--   3. Las facturas de plataforma por revisar, ligadas por su número (las 15
--      ligadas a la liquidación de otra y las 8 sin ligar, medidas el 01/11) y
--      apuntadas solas las que estén seguras al 100 %; las demás, con su motivo.
--      Lo que sale queda en el parte (raise notice) y en supplier_invoice_auto.
-- Mueve filas: va con «autorizo». Filtra siempre por la cuenta de Foodint.
-- Vuelta atrás: supabase/vuelta-atras/20261101T1732_s01o_foodint.down.sql

create table if not exists public.s01o_ficha_puesta (
  link_id uuid primary key, account_id uuid not null, puesto_at timestamptz not null default now()
);
alter table public.s01o_ficha_puesta enable row level security;
revoke all on public.s01o_ficha_puesta from public, anon, authenticated;

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_r jsonb; x record; v_id uuid;
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'S01o: esta base no tiene Foodint: no se toca nada.';
    return;
  end if;
  -- 1 · La ficha de cada plataforma (por su canal, dentro de la cuenta: regla 9).
  for x in
    select ps.supplier_id, c.papel, a.id as cuenta
      from (values ('Glovo', 'gasto', '62300001'), ('Uber', 'gasto', '62300002'), ('Uber', 'publicidad', '62700002'),
                   ('JustEat', 'gasto', '62300003'), ('JustEat', 'publicidad', '62700003')) as c(canal, papel, codigo)
      join public.sales_channel sc on sc.account_id = v_acc and sc.name = c.canal
      join public.party_role pl on pl.account_id = v_acc and pl.role = 'platform' and pl.channel_id = sc.id
      join public.party_role ps on ps.account_id = v_acc and ps.role = 'supplier' and ps.party_id = pl.party_id and ps.supplier_id is not null
      join public.company_account a on a.company_id = v_e and a.code = c.codigo
  loop
    if not exists (select 1 from public.company_account_link k where k.company_id = v_e and k.entity = 'supplier' and k.entity_id = x.supplier_id::text and k.role = x.papel) then
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
      values (v_acc, v_e, x.cuenta, 'supplier', x.supplier_id::text, x.papel, 'manual') returning id into v_id;
      insert into public.s01o_ficha_puesta (link_id, account_id) values (v_id, v_acc);
    end if;
  end loop;
  raise notice 'S01o · 1: puestas % cuentas en las fichas de las plataformas.', (select count(*) from public.s01o_ficha_puesta where account_id = v_acc);
  -- 2 · El interruptor.
  update public.company_purchase_setting set post_safe_invoices = true, updated_at = now(), updated_by_name = 'Sumied (S01o)'
   where company_id = v_e and account_id = v_acc and post_safe_invoices is distinct from true;
  if not exists (select 1 from public.company_purchase_setting where company_id = v_e and account_id = v_acc and post_safe_invoices) then
    raise exception 'S01o · 2: el interruptor de Foodint no ha quedado encendido (¿no tiene su fila de compras?).';
  end if;
  -- 3 · Ligar por su número y apuntar lo seguro.
  v_r := public._conta_plataformas_apuntar(v_e);
  raise notice 'S01o · 3: %', v_r;
end $$;
