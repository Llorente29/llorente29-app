-- supabase/migrations/20261030T0950_lab2_importador_filas.sql
--
-- LAB2 · Importador del historial de personal desde Cegid, tanda 2 (30/10/2026):
-- las FILAS de las nueve hojas, tal cual, en lab_import_fila (de la 0850).
-- Plan: docs/laboral/importador_cegid_plan.md (§2.1, §3 paso 2 y §4).
--
-- SOLO AÑADE: dos funciones nuevas. No toca las tablas de la 0850 ni su
-- lab_import_leer_cabeceras.
--
--   1. lab_import_cargar_filas(lote, hoja, desde, filas): guarda un trozo de
--      filas de una hoja. Cada fila, con su número («fila 37 de Contratos»),
--      tal cual (las cabeceras de Cegid como claves) y su huella. Volver a
--      cargar el mismo fichero pisa cada fila por su número: no duplica.
--   2. lab_import_terminar_filas(lote, esperadas): al acabar, quita las filas
--      que sobran de una lectura anterior más larga y devuelve, hoja a hoja,
--      cuántas se esperaban y cuántas hay. Lo cargado se cuenta siempre de
--      lab_import_fila, nunca se apunta aparte: así lo que se dice es lo que hay.
--
-- Solo el administrador de la cuenta del lote, y solo con el lote «leido» (el
-- volcado a fichas y contratos es del N1). Las filas llevan datos personales
-- (DNI, NAF, IBAN, salarios): lab_import_fila ya es «solo administrador» y sin
-- escritura directa (0850).
--
-- Vuelta atrás: supabase/vuelta-atras/20261030T0950_lab2_importador_filas.down.sql

create or replace function public.lab_import_cargar_filas(p_lote uuid, p_hoja text, p_desde integer, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lote public.lab_import_lote;
  v_n int;
  v_nuevas int;
begin
  select * into v_lote from public.lab_import_lote where id = p_lote;
  if v_lote.id is null or not public.current_user_is_admin_of(v_lote.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El historial de personal lo importa el administrador de la cuenta.';
  end if;
  if v_lote.estado <> 'leido' then
    raise exception 'LOTE_NO_LEIDO' using errcode = '22023', hint = 'Las filas se cargan en un lote recién leído.';
  end if;
  if p_hoja not in ('empresa', 'convenio', 'tablas_salariales', 'conceptos', 'trabajadores',
                    'contratos', 'nominas', 'nominas_conceptos', 'cuadre_contable') then
    raise exception 'HOJA_DESCONOCIDA' using errcode = '22023';
  end if;
  if p_desde is null or p_desde < 1 then
    raise exception 'FILA_INICIAL_MAL' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'SIN_FILAS' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 1000 or pg_column_size(p_filas) > 2097152 then
    raise exception 'TROZO_DEMASIADO_GRANDE' using errcode = '22023', hint = 'Como mucho 1.000 filas o 2 MB por trozo.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_filas) f where jsonb_typeof(f) <> 'object') then
    raise exception 'FILA_MAL_FORMADA' using errcode = '22023', hint = 'Cada fila va como sus columnas y sus valores.';
  end if;

  select count(*) into v_nuevas
    from jsonb_array_elements(p_filas) with ordinality f(datos, i)
   where not exists (select 1 from public.lab_import_fila x
                      where x.lote_id = p_lote and x.hoja = p_hoja and x.fila_n = p_desde + f.i::int - 1);

  insert into public.lab_import_fila (lote_id, account_id, hoja, fila_n, datos, huella)
  select p_lote, v_lote.account_id, p_hoja, p_desde + f.i::int - 1, f.datos, md5(f.datos::text)
    from jsonb_array_elements(p_filas) with ordinality f(datos, i)
  on conflict (lote_id, hoja, fila_n) do update
     set datos = excluded.datos, huella = excluded.huella,
         estado = 'ok', mensajes = '{}', destino_tabla = null, destino_id = null
   where public.lab_import_fila.huella is distinct from excluded.huella;
  get diagnostics v_n = row_count;

  return jsonb_build_object('hoja', p_hoja, 'recibidas', jsonb_array_length(p_filas),
                            'nuevas', v_nuevas, 'cambiadas', v_n - v_nuevas);
end $$;
revoke all on function public.lab_import_cargar_filas(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.lab_import_cargar_filas(uuid, text, integer, jsonb) to authenticated;

-- p_esperadas: {"<hoja>": <filas que trae el fichero>, …}. Quita lo que sobra de
-- una lectura anterior (filas por encima de lo que trae ahora, u hojas que ya no
-- trae) y devuelve {"<hoja>": {"esperadas": n, "cargadas": n}, …} contado de la
-- tabla, y "completo": todas iguales.
create or replace function public.lab_import_terminar_filas(p_lote uuid, p_esperadas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lote public.lab_import_lote;
  v_quitadas int;
  v_hojas jsonb;
begin
  select * into v_lote from public.lab_import_lote where id = p_lote;
  if v_lote.id is null or not public.current_user_is_admin_of(v_lote.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El historial de personal lo importa el administrador de la cuenta.';
  end if;
  if v_lote.estado <> 'leido' then
    raise exception 'LOTE_NO_LEIDO' using errcode = '22023';
  end if;
  if jsonb_typeof(p_esperadas) is distinct from 'object'
     or exists (select 1 from jsonb_each(p_esperadas) e where jsonb_typeof(e.value) <> 'number') then
    raise exception 'ESPERADAS_MAL_FORMADAS' using errcode = '22023';
  end if;

  delete from public.lab_import_fila f
   where f.lote_id = p_lote
     and (not (p_esperadas ? f.hoja) or f.fila_n > (p_esperadas ->> f.hoja)::int);
  get diagnostics v_quitadas = row_count;

  select coalesce(jsonb_object_agg(h.hoja, jsonb_build_object('esperadas', h.esperadas, 'cargadas', h.cargadas)), '{}'::jsonb)
    into v_hojas
    from (select e.key hoja, (e.value)::text::int esperadas,
                 (select count(*) from public.lab_import_fila f where f.lote_id = p_lote and f.hoja = e.key)::int cargadas
            from jsonb_each(p_esperadas) e) h;

  return jsonb_build_object(
    'hojas', v_hojas,
    'quitadas', v_quitadas,
    'cargadas', (select count(*) from public.lab_import_fila where lote_id = p_lote),
    'completo', not exists (select 1 from jsonb_each(v_hojas) x where (x.value ->> 'esperadas') <> (x.value ->> 'cargadas')));
end $$;
revoke all on function public.lab_import_terminar_filas(uuid, jsonb) from public, anon;
grant execute on function public.lab_import_terminar_filas(uuid, jsonb) to authenticated;
