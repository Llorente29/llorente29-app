-- supabase/migrations/20261120T2011_x10f_lote_desde_el_servidor.sql
-- cambia: public.conta_erp10_lote_apuntar(uuid,date,jsonb,jsonb,text) · prueba: supabase/staging/sql/20261120_x10f_cola_erp10_prueba.sql
--
-- X10f · Lo que sale solo a ERP10 se apunta en la salida de Sumied igual que lo que sale con el
-- botón: con conta_erp10_lote_apuntar. Hasta hoy pedía una sesión de administrador; la cola
-- (conta-erp10-cola) va sin sesión, con la clave de servicio. Cambia SOLO la guarda del principio:
-- sin sesión (auth.uid() nulo, que solo es el servidor: anon no tiene permiso), no se pide ser de la
-- cuenta ni administrador. Con sesión, igual que antes. Lo demás, byte a byte como en
-- 20261117T1011_x02_salida_erp10_funciones.sql. Misma firma: create or replace, no una sobrecarga
-- (regla 2).
--
-- Antes de cambiarla se guarda la de producción, byte a byte (_respaldar_funcion); la vuelta atrás
-- (supabase/vuelta-atras/20261120T2011_x10f_lote_desde_el_servidor.down.sql) la restaura de ahí,
-- comprobando la huella.
--
-- Nada en el camino del pedido. El real lo lanza Julio.

select public._respaldar_funcion('public.conta_erp10_lote_apuntar(uuid,date,jsonb,jsonb,text)', '20261120T2011_x10f_lote_desde_el_servidor');

create or replace function public.conta_erp10_lote_apuntar(
  p_company uuid, p_mes date, p_ficheros jsonb, p_partidas jsonb, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_ini date := date_trunc('month', p_mes)::date;
  v_ps jsonb;
  v_quien text;
  v_lote uuid;
  x jsonb;
  v_p jsonb;
  v_id uuid;
  v_n_rec int := 0; v_n_emi int := 0; v_n_asi int := 0; v_n_cue int := 0;
  v_vistas uuid[] := '{}';
begin
  select * into v_c from public.company where id = p_company;
  -- X10f: sin sesión (auth.uid() nulo) solo llega el servidor (service_role; anon no tiene permiso):
  -- la cola de conta-erp10-cola apunta lo que ha salido solo. Con sesión, como siempre.
  if v_c.id is null or (auth.uid() is not null and not public.belongs_to_account(v_c.account_id)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if auth.uid() is not null and not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta saca los ficheros para ERP10.' using errcode = '42501';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  -- Dos a la vez en la misma empresa, una detrás de otra.
  perform pg_advisory_xact_lock(hashtextextended('conta_erp10_lote:' || v_c.id, 0));

  if p_ficheros is null or jsonb_typeof(p_ficheros) <> 'array' or jsonb_array_length(p_ficheros) = 0 then
    raise exception 'Faltan los ficheros que han salido.' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(p_ficheros) loop
    if jsonb_typeof(x) <> 'object' or coalesce(btrim(x ->> 'nombre'), '') = '' or coalesce(btrim(x ->> 'huella'), '') = ''
       or coalesce(x ->> 'filas', '') !~ '^[0-9]+$' then
      raise exception 'Cada fichero lleva su nombre, cuántas filas tiene y su huella.' using errcode = '22023';
    end if;
  end loop;
  if p_partidas is null or jsonb_typeof(p_partidas) <> 'array' or jsonb_array_length(p_partidas) = 0 then
    raise exception 'No hay nada que apuntar: el lote no lleva ninguna partida.' using errcode = '22023';
  end if;

  -- Lo que sale ahora, con las mismas reglas que enseña la pantalla.
  v_ps := public.conta_erp10_por_salir(v_c.id, v_ini);

  for x in select * from jsonb_array_elements(p_partidas) loop
    if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'entry_id', '') !~ '^[0-9a-fA-F-]{36}$' or coalesce(btrim(x ->> 'huella'), '') = ''
       or coalesce(x ->> 'clase', '') not in ('recibida', 'emitida', 'asiento') then
      raise exception 'Cada partida lleva su asiento, su clase (recibida, emitida o asiento) y su huella.' using errcode = '22023';
    end if;
    v_id := (x ->> 'entry_id')::uuid;
    if v_id = any (v_vistas) then
      raise exception 'Un mismo asiento viene dos veces en el lote: no se apunta nada.' using errcode = '23505';
    end if;
    v_vistas := v_vistas || v_id;
    if not exists (select 1 from public.journal_entry e where e.id = v_id and e.company_id = v_c.id and e.account_id = v_c.account_id) then
      raise exception 'Un asiento del lote no es de esta empresa: no se apunta nada.' using errcode = '23514';
    end if;
    if exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = v_id and p.estado = 'salida') then
      raise exception 'El asiento %/% ya salió a ERP10: no se apunta nada.',
        (select series from public.journal_entry where id = v_id), (select number from public.journal_entry where id = v_id) using errcode = '23505';
    end if;
    select p into v_p from jsonb_array_elements(v_ps -> 'partidas') p where p ->> 'entry_id' = v_id::text;
    if v_p is null then
      raise exception 'El asiento %/% no está en lo que sale este mes: no se apunta nada.',
        (select series from public.journal_entry where id = v_id), (select number from public.journal_entry where id = v_id) using errcode = '23514';
    end if;
    if not (v_p ->> 'sale')::boolean then
      raise exception 'El asiento %/% no puede salir (%): no se apunta nada.', v_p ->> 'serie', v_p ->> 'numero', v_p -> 'avisos' ->> 0 using errcode = '23514';
    end if;
    if v_p ->> 'clase' <> x ->> 'clase' then
      raise exception 'El asiento %/% sale como «%», no como «%»: no se apunta nada.', v_p ->> 'serie', v_p ->> 'numero', v_p ->> 'clase', x ->> 'clase' using errcode = '23514';
    end if;
  end loop;

  v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  insert into public.conta_erp10_salida_lote (account_id, company_id, mes, ficheros, creado_por, creado_por_nombre)
  values (v_c.account_id, v_c.id, v_ini, p_ficheros, auth.uid(), v_quien)
  returning id into v_lote;

  -- Si otra pestaña ha apuntado lo mismo a la vez, el índice único lo para (y no queda nada: es una sola transacción).
  begin
    for x in select * from jsonb_array_elements(p_partidas) loop
      insert into public.conta_erp10_salida_partida (account_id, company_id, lote_id, entry_id, clase, huella)
      values (v_c.account_id, v_c.id, v_lote, (x ->> 'entry_id')::uuid, x ->> 'clase', btrim(x ->> 'huella'));
      case x ->> 'clase' when 'recibida' then v_n_rec := v_n_rec + 1; when 'emitida' then v_n_emi := v_n_emi + 1; else v_n_asi := v_n_asi + 1; end case;
    end loop;
  exception when unique_violation then
    raise exception 'Algo de este lote ya salió a ERP10 (otra pestaña u otro clic a la vez): no se apunta nada.' using errcode = '23505';
  end;

  -- Las cuentas nuevas que usan estas partidas (las que caben: las otras ya pararon arriba).
  insert into public.conta_erp10_subcuenta_salida (account_id, company_id, lote_id, company_account_id, codigo, codigo_erp10, nombre)
  select v_c.account_id, v_c.id, v_lote, (c ->> 'company_account_id')::uuid, c ->> 'codigo', c ->> 'codigo_erp10', c ->> 'nombre'
    from jsonb_array_elements(v_ps -> 'cuentas_nuevas') c
   where (c ->> 'cabe')::boolean
     and exists (select 1 from public.journal_line l
                  where l.company_account_id = (c ->> 'company_account_id')::uuid and l.account_id = v_c.account_id
                    and l.entry_id = any (v_vistas));
  get diagnostics v_n_cue = row_count;

  update public.conta_erp10_salida_lote set recibidas = v_n_rec, emitidas = v_n_emi, asientos = v_n_asi, cuentas_nuevas = v_n_cue
   where id = v_lote;

  return jsonb_build_object('lote', v_lote, 'mes', v_ini, 'recibidas', v_n_rec, 'emitidas', v_n_emi, 'asientos', v_n_asi,
    'cuentas_nuevas', v_n_cue, 'ficheros', jsonb_array_length(p_ficheros), 'quien', v_quien,
    'texto', format('Apuntado lo que sale de %s: %s %s, %s %s, %s %s y %s %s.',
      to_char(v_ini, 'MM/YYYY'),
      v_n_rec, case v_n_rec when 1 then 'factura recibida' else 'facturas recibidas' end,
      v_n_emi, case v_n_emi when 1 then 'factura emitida' else 'facturas emitidas' end,
      v_n_asi, case v_n_asi when 1 then 'asiento' else 'asientos' end,
      v_n_cue, case v_n_cue when 1 then 'cuenta nueva' else 'cuentas nuevas' end));
end $$;
comment on function public.conta_erp10_lote_apuntar(uuid, date, jsonb, jsonb, text) is
  'X02 · Apunta lo que ha salido a ERP10, en una transacción: el lote con sus ficheros, cada partida con su huella y las cuentas nuevas que usan. Para sin apuntar nada si una partida ya salió, no es de la empresa, no está en lo que sale o no sale como esa clase. Solo un administrador; X10f: o el servidor, sin sesión (la cola de conta-erp10-cola).';
