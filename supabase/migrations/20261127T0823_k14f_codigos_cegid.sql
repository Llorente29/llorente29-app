-- supabase/migrations/20261127T0823_k14f_codigos_cegid.sql
--
-- K14f · 6 fichas de QBO atadas a su cliente de Cegid (Julio, 27/11), por el mismo camino que la K14e:
-- _conta_cegid_atar (Q10) pone conta_cobro_cliente.codigo_cliente y lo apunta en conta_cegid_atado («a_mano»).
-- Comprobado antes en Cegid, solo leyendo (GetCustomer, workflow «Ver incidencias en Cegid»): cada código existe y su NIF
-- es el de su ficha. Consorcio K (1266) no se toca: ya lo ató la K14e.
--
--   ficha (party)                          código
--   7ea5b89a-924c-4c3a-9426-99a4e606f278    725
--   21bc2411-ce14-4fbb-8089-9c0181084958   1006
--   a91d7dab-a651-4a17-a977-f061d3aa80fc   1259
--   35182a93-1085-47f4-b890-4c69eb3838d3    818
--   bd1170c8-cb8e-4ae1-8083-d903d543d6a0   1271
--   198dc23e-072a-4257-8c3c-130ea35065a7   1272
--
-- Para si alguna ficha ya tiene código o un código ya es de otra ficha. Sin nombres ni NIF (T11). No manda nada a Cegid.
-- Nada en el camino del pedido.

do $$
declare emp constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4'; cta constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655'; r record;
begin
  if not exists (select 1 from public.company where id = emp) then
    raise notice 'K14f: esta base no tiene QBO Integrity: nada que atar.';
    return;
  end if;
  create temp table _k14f (party_id uuid, codigo int) on commit drop;
  insert into _k14f values
    ('7ea5b89a-924c-4c3a-9426-99a4e606f278', 725),
    ('21bc2411-ce14-4fbb-8089-9c0181084958', 1006),
    ('a91d7dab-a651-4a17-a977-f061d3aa80fc', 1259),
    ('35182a93-1085-47f4-b890-4c69eb3838d3', 818),
    ('bd1170c8-cb8e-4ae1-8083-d903d543d6a0', 1271),
    ('198dc23e-072a-4257-8c3c-130ea35065a7', 1272);
  -- Como se midió el 27/11: las 6 fichas, de QBO y sin código; los 6 códigos, de nadie.
  if (select count(*) from _k14f x join public.party p on p.id = x.party_id and p.account_id = cta and p.archived_at is null) <> 6
     or exists (select 1 from public.conta_cobro_cliente c join _k14f x on x.party_id = c.party_id where c.company_id = emp and c.codigo_cliente is not null)
     or exists (select 1 from public.conta_cobro_cliente c join _k14f x on x.codigo = c.codigo_cliente where c.company_id = emp) then
    raise exception 'K14f · 0: las 6 fichas no están como se midieron el 27/11 (de QBO, sin código, y sus códigos libres).';
  end if;
  for r in select * from _k14f order by codigo loop
    perform public._conta_cegid_atar(emp, r.party_id, r.codigo, 'a_mano', 'K14f · códigos de Cegid del 27/11');
  end loop;
  raise notice 'K14f: 6 fichas atadas a su cliente de Cegid.';
end $$;
