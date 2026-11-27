-- supabase/vuelta-atras/20261126T0652_q10d_fichas_a_cegid.down.sql
--
-- Vuelta atrás de la 0652 (Q10 · las 19 fichas de QBO atadas a Cegid): a cada ficha le devuelve el código que tenía
-- antes (ninguno) y quita su apunte en conta_cegid_atado. Solo lo que ató la 0652 (por su «quien»), y solo si la ficha
-- sigue con el código que le puso.

do $vuelta$
declare v_quien constant text := 'Julio (respuesta Q10 · 4, 26/11)'; r record; n int := 0;
begin
  if to_regclass('public.conta_cegid_atado') is null then return; end if;
  for r in select id, company_id, party_id, codigo, codigo_antes from public.conta_cegid_atado where quien = v_quien loop
    update public.conta_cobro_cliente set codigo_cliente = r.codigo_antes, updated_at = now(), updated_by_name = 'Q10 · 0652 · deshecho'
     where company_id = r.company_id and party_id = r.party_id and codigo_cliente = r.codigo;
    delete from public.conta_cegid_atado where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'Q10 · 0652 vuelta atrás: % fichas sin su código de Cegid otra vez.', n;
end $vuelta$;
