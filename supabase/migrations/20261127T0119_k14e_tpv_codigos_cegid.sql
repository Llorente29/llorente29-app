-- supabase/migrations/20261127T0119_k14e_tpv_codigos_cegid.sql
--
-- K14e · Los 5 clientes de los pagos con tarjeta de QBO, dados de alta en Cegid (27/11), atados a su ficha de Sumied y a
-- sus pagos de conta_banco_cobro_tarjeta. Comprobado antes en Cegid, solo leyendo (GetCustomer, workflow «Ver
-- incidencias en Cegid», run 45916016296): los 5 códigos existen y su NIF es el de la ficha.
--
--   ficha (party)                          código   pago (negociación)
--   f8938378-aad9-4ba8-8806-583ab50fb640   1266     25347
--   2af272da-8092-4673-9013-dec95c119145   1267     26805
--   6d206f9f-25d3-4da3-84bc-db5dcd677d29   1268     26806
--   75f926e5-6949-443e-8f35-51abbd9f86dd   1269     26809
--   f7ffc4c8-0152-428e-97b0-adc84ddded75   1270     26804
--
-- La ficha se ata por el camino de siempre, _conta_cegid_atar (Q10): conta_cobro_cliente.codigo_cliente, apuntado en
-- conta_cegid_atado («a_mano», quién: K14e). Cada pago, su cegid_codigo. Para si alguna ficha ya tiene código, si un
-- código ya es de otra ficha o si los pagos no son los de esas fichas. Sin nombres ni NIF (T11). No manda nada a Cegid.
-- Nada en el camino del pedido.

do $$
declare emp constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4'; cta constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655';
  r record; v_n int;
begin
  if not exists (select 1 from public.conta_banco_cobro_tarjeta where company_id = emp) then
    raise notice 'K14e: esta base no tiene los pagos con tarjeta de QBO Integrity: nada que atar.';
    return;
  end if;
  create temp table _k14e (party_id uuid, codigo int, crm_id text) on commit drop;
  insert into _k14e values
    ('f8938378-aad9-4ba8-8806-583ab50fb640', 1266, '25347'),
    ('2af272da-8092-4673-9013-dec95c119145', 1267, '26805'),
    ('6d206f9f-25d3-4da3-84bc-db5dcd677d29', 1268, '26806'),
    ('75f926e5-6949-443e-8f35-51abbd9f86dd', 1269, '26809'),
    ('f7ffc4c8-0152-428e-97b0-adc84ddded75', 1270, '26804');
  -- Como se midió el 27/11: las 5 fichas, de QBO y sin código; los 5 códigos, de nadie; cada pago, casado, de su ficha y
  -- sin código de Cegid.
  if (select count(*) from _k14e x join public.party p on p.id = x.party_id and p.account_id = cta and p.archived_at is null) <> 5
     or exists (select 1 from public.conta_cobro_cliente c join _k14e x on x.party_id = c.party_id where c.company_id = emp and c.codigo_cliente is not null)
     or exists (select 1 from public.conta_cobro_cliente c join _k14e x on x.codigo = c.codigo_cliente where c.company_id = emp)
     or (select count(*) from _k14e x join public.conta_banco_cobro_tarjeta t on t.company_id = emp and t.crm_id = x.crm_id
          and t.party_id = x.party_id and t.estado = 'casado' and t.cegid_codigo is null) <> 5 then
    raise exception 'K14e · 0: las 5 fichas o sus pagos no están como se midieron el 27/11 (sin código, códigos libres, pagos casados de su ficha).';
  end if;
  for r in select * from _k14e order by codigo loop
    perform public._conta_cegid_atar(emp, r.party_id, r.codigo, 'a_mano', 'K14e · alta en Cegid del 27/11');
  end loop;
  update public.conta_banco_cobro_tarjeta t set cegid_codigo = x.codigo
    from _k14e x where t.company_id = emp and t.crm_id = x.crm_id;
  get diagnostics v_n = row_count;
  raise notice 'K14e: 5 fichas atadas a su cliente de Cegid (1266–1270) y % pagos con su código.', v_n;
end $$;
