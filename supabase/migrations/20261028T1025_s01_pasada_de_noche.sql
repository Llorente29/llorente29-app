-- supabase/migrations/20261028T1025_s01_pasada_de_noche.sql
--
-- S01 · PR 3 · Entrega 5 (PC01, punto 3): LA PASADA DE LAS 03:40 de Madrid.
-- Con «Proponer lo pendiente» quitado de Asientos, cada noche:
--   1. recoge lo que se haya quedado atrás de los cinco orígenes (nóminas, lo
--      recibido sin factura, el no confirmado que una liquidación paga, el
--      socio de marca y la liquidación de plataforma), con sus proponedores de
--      siempre (una sola copia de cada regla: 0800, 0830, 0849, 0905 y 0929);
--      lo que no puede proponer queda, con su porqué, en su apartado;
--   2. valida solo lo «seguro», igual que hacía el botón: las propuestas de
--      ventas del día «seguro» y sin «Mira esto», en las empresas que tienen
--      encendido «Validar solos los Seguros de ventas»
--      (company_tax_profile.journal_autovalidate_sales_day). Nada más.
-- Desde el primer día abierto de los últimos 120 días hasta hoy: lo de antes
-- es del programa anterior o está cerrado.
--
-- Solo añade: dos funciones, un procedimiento y su cron.
--
-- La hora: pg_cron va en UTC; el cron salta a las 01:40 y a las 02:40 UTC y el
-- procedimiento solo trabaja si en Madrid son las 3 (guarda del cambio de hora:
-- 03:40 en verano y en invierno, una vez por noche).
-- Si falla una empresa, sigue con las demás y termina con ERROR: pg_cron lo
-- apunta «failed», no como aviso (regla 8).
--
-- Vuelta atrás: supabase/vuelta-atras/20261028T1025_s01_pasada_de_noche.down.sql

-- ── 1 · Una empresa ────────────────────────────────────────────────────────
create or replace function public.conta_propuestas_de_noche(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_hoy date := public.conta_hoy(); v_desde date;
  v_quien constant text := 'Sumied (pasada de noche)';
  v_res jsonb := '{}'::jsonb; v_fallos jsonb := '[]'::jsonb; x jsonb;
  v_validadas int := 0; r record;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  -- La llama el cron (sin nadie) o un administrador o encargado de la cuenta.
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta pasa la pasada de noche.' using errcode = '42501';
  end if;
  v_desde := public.conta_primer_dia_abierto(p_company, v_hoy - 120);
  if v_desde is null or v_desde > v_hoy then
    return jsonb_build_object('desde', null, 'hasta', v_hoy, 'nada', 'No hay ningún día abierto en los últimos 120 días.');
  end if;

  -- 1 · Los cinco orígenes. Cada uno en su bloque: si uno falla, los demás siguen y se dice.
  begin x := public.conta_proponer_nominas(p_company, v_desde, v_hoy, v_quien); v_res := v_res || jsonb_build_object('nominas', x);
  exception when others then v_fallos := v_fallos || to_jsonb(format('nóminas: %s (%s)', sqlerrm, sqlstate)); end;
  begin x := public.conta_proponer_recibidos(p_company, v_desde, v_hoy, v_quien); v_res := v_res || jsonb_build_object('recibido', x);
  exception when others then v_fallos := v_fallos || to_jsonb(format('recibido sin factura: %s (%s)', sqlerrm, sqlstate)); end;
  begin x := public.conta_proponer_pagados_despues(p_company, v_quien); v_res := v_res || jsonb_build_object('pagado', x);
  exception when others then v_fallos := v_fallos || to_jsonb(format('pagado después: %s (%s)', sqlerrm, sqlstate)); end;
  begin x := public.conta_proponer_socios(p_company, v_desde, v_hoy, v_quien); v_res := v_res || jsonb_build_object('socio', x);
  exception when others then v_fallos := v_fallos || to_jsonb(format('socio de marca: %s (%s)', sqlerrm, sqlstate)); end;
  begin x := public.conta_proponer_plataformas(p_company, v_desde, v_hoy, v_quien); v_res := v_res || jsonb_build_object('plataforma', x);
  exception when others then v_fallos := v_fallos || to_jsonb(format('plataforma: %s (%s)', sqlerrm, sqlstate)); end;

  -- 2 · Solo lo «seguro» de ventas, si la empresa lo tiene encendido (como el botón).
  if exists (select 1 from public.company_tax_profile p
              where p.company_id = p_company and p.account_id = v_cuenta and p.journal_autovalidate_sales_day) then
    for r in
      select e.id, e.entry_date from public.journal_entry e
       where e.account_id = v_cuenta and e.company_id = p_company
         and e.source_type = 'sales_day' and e.status = 'propuesto' and e.confidence = 'seguro'
         and e.entry_date between v_desde and v_hoy
         and not exists (select 1 from jsonb_array_elements(coalesce(e.reasons, '[]'::jsonb)) z where z->>'decision' = 'Mira esto')
       order by e.entry_date, e.id
    loop
      begin
        perform public._journal_entry_validar(r.id, 'Folvy (validación automática de ventas)');
        v_validadas := v_validadas + 1;
      exception when others then
        v_fallos := v_fallos || to_jsonb(format('validar las ventas del %s: %s (%s)', to_char(r.entry_date, 'DD/MM/YYYY'), sqlerrm, sqlstate));
      end;
    end loop;
  end if;

  return v_res || jsonb_build_object('desde', v_desde, 'hasta', v_hoy, 'validadasSolas', v_validadas, 'fallos', v_fallos);
end $$;
comment on function public.conta_propuestas_de_noche(uuid) is
  'S01 · PR 3 · Entrega 5: la pasada de noche de una empresa. Propone lo que se haya quedado atrás de los cinco orígenes (nóminas, recibido sin factura, pagado después, socio y plataforma) y valida solo las ventas del día «seguro» sin «Mira esto» si la empresa lo tiene encendido. Devuelve lo hecho y los fallos, sin parar en el primero.';
revoke all on function public.conta_propuestas_de_noche(uuid) from public, anon;
grant execute on function public.conta_propuestas_de_noche(uuid) to authenticated;

-- ── 2 · Todas las empresas, a las 03:40 de Madrid ───────────────────────────
create or replace procedure public.conta_propuestas_de_noche_todas()
language plpgsql as $procedure$
declare
  r        record;
  v_p      jsonb;
  v_fallos text[] := '{}';
begin
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 3 then return; end if;
  for r in select c.id from public.company c where coalesce(c.is_active, true) order by c.id loop
    begin
      v_p := public.conta_propuestas_de_noche(r.id);
      if jsonb_array_length(coalesce(v_p->'fallos', '[]'::jsonb)) > 0 then
        v_fallos := v_fallos || format('%s: %s', r.id, (select string_agg(f, ' · ') from jsonb_array_elements_text(v_p->'fallos') f));
      end if;
    exception when others then
      v_fallos := v_fallos || format('%s: %s (%s)', r.id, sqlerrm, sqlstate);
    end;
    commit;
  end loop;
  if cardinality(v_fallos) > 0 then
    raise exception 'Pasada de noche: falló en % empresa(s): %', cardinality(v_fallos), array_to_string(v_fallos, ' · ');
  end if;
end
$procedure$;
comment on procedure public.conta_propuestas_de_noche_todas() is
  'S01 · PR 3 · Entrega 5: la pasada de noche de cada empresa activa, confirmando una a una. La llama el cron conta-propuestas-de-noche; solo trabaja a las 3 de Madrid. Si alguna falla, termina con error.';
revoke execute on procedure public.conta_propuestas_de_noche_todas() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'conta-propuestas-de-noche') then
      perform cron.unschedule('conta-propuestas-de-noche');
    end if;
    perform cron.schedule('conta-propuestas-de-noche', '40 1,2 * * *', $cron$call public.conta_propuestas_de_noche_todas()$cron$);
  end if;
end $$;
