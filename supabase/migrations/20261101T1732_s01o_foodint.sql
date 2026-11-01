-- supabase/migrations/20261101T1732_s01o_foodint.sql
--
-- S01o · Foodint (Julio, 01/11, respuestas 2 y 3): la ficha de cada plataforma,
-- con su cuenta de gasto y de publicidad, las que Foodint ya usa en su historia:
-- Glovo 62300001 (toda su factura, también Glovo Ads); Uber 62300002 y 62700002;
-- Just Eat 62300003 y 62700003. Solo eso.
--   · El interruptor «Apuntar solo lo seguro» de Foodint sigue APAGADO: lo enciende
--     Julio desde Ajustes cuando la pantalla de «Apuntadas solas» con «Deshacer»
--     esté en producción. Así nada se apunta solo antes de poder verlo y deshacerlo.
--   · No hace la primera pasada: la hace la tarea programada (:07 y :37) cuando
--     el interruptor esté encendido. Así la tanda no deja asientos validados que su
--     vuelta atrás no puede quitar, y el motivo de cada factura queda en
--     supplier_invoice_auto.
-- Solo añade filas (los enlaces de la ficha, con su rastro en s01o_ficha_puesta). Filtra por la cuenta de Foodint.
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
  x record; v_id uuid;
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
  raise notice 'S01o: puestas % cuentas en las fichas de las plataformas.', (select count(*) from public.s01o_ficha_puesta where account_id = v_acc);
  -- Las cinco de la tabla de Julio, ni una menos: si falta alguna, para (la ficha no diría lo que él decidió).
  if (select count(*) from public.company_account_link k join public.company_account a on a.id = k.company_account_id
       where k.account_id = v_acc and k.company_id = v_e and k.entity = 'supplier' and k.role in ('gasto', 'publicidad')
         and a.code in ('62300001', '62300002', '62700002', '62300003', '62700003')) <> 5 then
    raise exception 'S01o: las fichas de las plataformas de Foodint no quedan con sus 5 cuentas (gasto y publicidad).';
  end if;
  -- El interruptor NO se toca aquí (Julio, 01/11, respuesta 3): lo enciende Julio cuando
  -- «Apuntadas solas» y «Deshacer» estén en producción; la pasada la hace entonces la tarea programada.
end $$;
