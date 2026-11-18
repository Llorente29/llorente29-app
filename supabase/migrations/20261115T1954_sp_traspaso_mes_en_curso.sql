-- supabase/migrations/20261115T1954_sp_traspaso_mes_en_curso.sql
--
-- SP · Traspasar a Diez el mes en curso (Julio, 15/11). Foodint ha dejado la actividad el 15/11 y la
-- gestoría necesita noviembre en Diez el 16/11; hasta hoy, un mes solo se podía traspasar a partir del
-- día 1 del siguiente. Julio decide: un administrador puede traspasar el mes en curso, con el aviso de que
-- lo que entre después con fecha de ese mes ya no viaja. Reversible (Julio, 15/11): la vuelta atrás deja
-- las dos funciones exactamente como estaban, desde su respaldo.
--
-- cambia: public.conta_traspaso_confirmar · prueba: supabase/staging/sql/20261115_sp_traspaso_mes_en_curso_prueba.sql
--   La guarda «el mes aún no ha terminado» pasa a ser «el mes aún no ha empezado»: el mes en curso se
--   puede confirmar; uno futuro, no. Misma firma, un solo trozo cambiado.
-- cambia: public.conta_traspaso_terminar · prueba: supabase/staging/sql/20261115_sp_traspaso_mes_en_curso_prueba.sql
--   Si el mes traspasado aún no ha terminado, NO se cierra en Sumied (cerrarlo mandaría lo que llegue
--   después al primer día abierto, del mes siguiente). Lo dice en el motivo. Misma firma, un solo trozo.
--
-- No toca ningún dato. Nada en el camino del pedido.

select public._respaldar_funcion('public.conta_traspaso_confirmar(uuid,date)', '20261115T1954_sp_traspaso_mes_en_curso');
select public._respaldar_funcion('public.conta_traspaso_terminar(uuid,jsonb,boolean)', '20261115T1954_sp_traspaso_mes_en_curso');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_traspaso_confirmar(uuid,date)'::regprocedure);
  v_viejo text := $viejo$  if v_mes >= date_trunc('month', (now() at time zone 'Europe/Madrid'))::date then
    raise exception 'El mes aún no ha terminado: se traspasa cuando acaba.' using errcode = '23514';$viejo$;
  v_nuevo text := $nuevo$  -- SP·traspaso (15/11): el mes en curso se puede traspasar; uno que aún no ha empezado, no.
  if v_mes > date_trunc('month', (now() at time zone 'Europe/Madrid'))::date then
    raise exception 'Ese mes aún no ha empezado: no hay nada que traspasar.' using errcode = '23514';$nuevo$;
begin
  if strpos(v_def, 'SP·traspaso (15/11)') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'SP: conta_traspaso_confirmar no es la medida (la guarda del mes no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_traspaso_terminar(uuid,jsonb,boolean)'::regprocedure);
  v_viejo text := $viejo$  elsif exists (select 1 from public.fiscal_period_lock k where k.company_id = v_t.company_id and k.month = v_t.mes and k.reopened_at is null) then$viejo$;
  v_nuevo text := $nuevo$  -- SP·traspaso (15/11): el mes en curso se traspasa, pero no se cierra (lo que llegue después iría al mes siguiente).
  elsif v_t.mes >= date_trunc('month', (now() at time zone 'Europe/Madrid'))::date then
    v_motivo := 'No se cierra el mes: aún no ha terminado. Lo que entre después con fecha de este mes no viaja a Diez.';
  elsif exists (select 1 from public.fiscal_period_lock k where k.company_id = v_t.company_id and k.month = v_t.mes and k.reopened_at is null) then$nuevo$;
begin
  if strpos(v_def, 'SP·traspaso (15/11)') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'SP: conta_traspaso_terminar no es la medida (el cierre del mes no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;
