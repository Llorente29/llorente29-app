-- supabase/vuelta-atras/20261106T2350_b01r_cargos_anulados.down.sql
--
-- Vuelta atrás de la 2350 (B01·19): los tres cargos del 30/10 vuelven a «por
-- aclarar», solo si siguen ignorados con el motivo de la tanda (si alguien los
-- ha tocado después, no se tocan), con su línea en el historial. Y se quita la
-- función de la tanda.

do $$
declare r record; v_n int := 0;
begin
  for r in select m.id, m.account_id, m.company_id from public.bank_movement m
            where m.id in ('9d7826af-32b0-4f45-9368-45f98a030d47', '1f73bfb3-8bb6-41e5-8110-8bbc31d0b0a4', 'b4a02704-b5bb-46cd-882e-c2e3f02b2918')
              and m.status = 'ignorado' and m.ignored_reason = 'Anulado por el banco: no había saldo'
            for update loop
    update public.bank_movement set status = 'por_aclarar', ignored_reason = null, updated_at = now() where id = r.id;
    perform public._bank_log(r.account_id, r.company_id, r.id, null, null, 'por_aclarar', 'folvy',
      'Vuelta atrás: vuelve a «por aclarar» (no era un cargo anulado por el banco)', '{}'::jsonb);
    v_n := v_n + 1;
  end loop;
  raise notice 'B01r anulados, vuelta atrás: % vuelven a «por aclarar».', v_n;
end $$;

drop function if exists public._b01r_ignorar_anulados(uuid, uuid, text, jsonb);
