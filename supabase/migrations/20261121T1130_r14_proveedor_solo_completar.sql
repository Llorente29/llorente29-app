-- supabase/migrations/20261121T1130_r14_proveedor_solo_completar.sql
--
-- R14 · El proveedor nuevo se da de alta solo. 3 de 3: lo que YA ESTABA se completa al
-- aplicar (encargo R14, punto 3), en todas las cuentas. Va detrás de la 1110 y la 1120.
-- Escribe sobre lo que existe: pide autorizo.
--
--   1. Julio, 21/11: las fichas de proveedor SUELTAS que son una plataforma de su cuenta (por
--      su NIF o, con un NIF de fuera o sin NIF, por su nombre) se unen al tercero de la
--      plataforma (_r14_unir): así «Cómo se paga» dice «Se paga con su liquidación» (K06).
--      Una por plataforma (la más antigua), y solo si la plataforma no tiene ya la suya.
--   2. Las recibidas leídas sin proveedor, que no están validadas, pagadas, descartadas ni
--      anuladas (_conta_proveedor_solo). Cada una en su propio bloque: si una falla, se queda
--      como hoy, apuntada con el código del error, y las demás siguen.
-- Lo que cuenta antes y después, y con la tanda puesta: scripts/conta/produccion/cuentas/r14-proveedor-solo.sql.
-- Se puede pasar dos veces (la segunda no encuentra nada).
-- Vuelta atrás: supabase/vuelta-atras/20261121T1130_r14_proveedor_solo_completar.down.sql

do $$
declare r record; v jsonb; v_p record;
begin
  -- 1 · Las sueltas que son una plataforma.
  for r in
    select s.id, s.account_id, s.tax_id, s.name, ps.party_id
      from public.supplier s
      join public.party_role ps on ps.supplier_id = s.id and ps.role = 'supplier'
     where s.archived_at is null
       and not exists (select 1 from public.party_role pp where pp.party_id = ps.party_id and pp.role = 'platform')
     order by s.account_id, s.created_at, s.id
  loop
    select p.party_id, p.como into v_p from public._r14_plataforma_de(r.account_id, r.tax_id, r.name) p;
    if v_p.party_id is not null and v_p.party_id <> r.party_id then
      perform public._r14_unir(r.id, v_p.party_id, v_p.como, 'al_aplicar');
    end if;
  end loop;

  -- 2 · Las leídas sin proveedor.
  for r in
    select i.id, i.account_id, i.company_id from public.supplier_invoice i
     where i.supplier_id is null and coalesce(i.reading, '{}'::jsonb) ? 'factura'
       and i.status not in ('descartada', 'anulada', 'pagada')
       and not exists (select 1 from public.conta_proveedor_solo x where x.invoice_id = i.id)
     order by i.account_id, i.company_id, i.created_at, i.id
  loop
    begin
      v := public._conta_proveedor_solo(r.id, 'al_aplicar');
    exception when others then
      insert into public.conta_proveedor_solo (invoice_id, account_id, company_id, que, motivo, cuando)
      values (r.id, r.account_id, r.company_id, 'no',
              'No he podido darlo de alta (' || sqlstate || case when sqlstate = '42703' then ': ' || substr(sqlerrm, 1, 120) else '' end || '): dalo de alta tú.', 'al_aplicar')
      on conflict (invoice_id) do nothing;
    end;
  end loop;
end $$;
