-- ============================================================================
-- C00 · Tarea 5 · Cambiar la actividad principal en un solo paso
-- ----------------------------------------------------------------------------
-- Entre las actividades vigentes de una empresa hay una y solo una principal:
-- un índice único parcial impide dos a la vez, y el disparador diferido
-- conta_una_principal impide ninguna al cerrar la transacción (0110).
--
-- Desde la app eso no se puede cambiar en dos llamadas: quitar la marca a la
-- vieja y luego ponérsela a la nueva deja, al final de la primera, cero
-- principales (salta el diferido); hacerlo al revés deja dos un momento
-- (salta el índice). Esta función hace las dos cosas en la misma transacción.
--
-- SECURITY INVOKER: la RLS de company_activity decide quién puede (admin o
-- encargado de la cuenta), igual que si la app escribiera directamente. No
-- está en el camino del pedido: no la llama ningún disparador, cron ni
-- función, y no toma cierre más que sobre las filas de una empresa.
-- ============================================================================

create or replace function public.conta_hacer_principal(p_actividad uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_empresa uuid; v_fin date; v_desc text;
begin
  select company_id, ended_on, description into v_empresa, v_fin, v_desc
    from public.company_activity where id = p_actividad;
  if v_empresa is null then
    raise exception 'No encuentro esa actividad' using errcode = '42501';
  end if;
  if v_fin is not null then
    raise exception 'Esa actividad ya terminó: no puede ser la principal' using errcode = '23514';
  end if;
  update public.company_activity set is_main = false
   where company_id = v_empresa and is_main and id <> p_actividad;
  update public.company_activity set is_main = true where id = p_actividad;
  if not found then
    raise exception 'No puedes cambiar las actividades de esta empresa' using errcode = '42501';
  end if;
  return jsonb_build_object('id', p_actividad, 'principal', v_desc);
end $$;
comment on function public.conta_hacer_principal(uuid) is
  'C00. Marca una actividad vigente como la principal de su empresa y desmarca la anterior, en la misma transacción.';
revoke all on function public.conta_hacer_principal(uuid) from public, anon;
grant execute on function public.conta_hacer_principal(uuid) to authenticated;
