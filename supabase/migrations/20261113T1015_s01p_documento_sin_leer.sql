-- supabase/migrations/20261113T1015_s01p_documento_sin_leer.sql
--
-- S01p·18.2 · punto 3 (= S01p·18, punto 5; Julio, 05/11 y 13/11). En «Por
-- aclarar», la ventana del documento sin leer:
--
--   · «No es una factura» daba error: conta_puerta_dime_que_es apunta su
--     actividad como 'persona' con p_quien_nombre, y cuando la pantalla no sabe
--     el nombre llega vacío; document_activity_check exige el nombre de la
--     persona. Ahora, si no llega, el de la sesión (conta_nombre_actor) y, si
--     tampoco, «una persona».
--   · «Eliminar» BORRA DE VERDAD (Julio, 13/11): la fila de la bandeja, su
--     actividad y lo que leyó la IA (goods_receipt_ai_session). El fichero del
--     almacén lo borra la pantalla con la API del almacén, no SQL (D lo
--     comprobó el 13/11 con la FAC-00410). Solo si el documento no ha llegado
--     a los libros: sin factura (la que lo nombra o la que nombra él, con o sin
--     asiento o pago), sin una recepción que use su lectura y sin otro
--     documento o factura con su mismo fichero. Si no se puede, se dice por qué
--     (conta_llegada_eliminable) y el botón no sale.
--     Hay tres esperando en Foodint (medidos el 13/11): los dos
--     «Compras-y-Ventas» del socio y EMPRESARIAL-COLON.pdf, los tres sin nada de
--     eso.
--
-- cambia: public.conta_puerta_dime_que_es · prueba: supabase/staging/sql/20261113_s01p_documento_sin_leer_prueba.sql
--
-- La de antes, con respaldo; dos reemplazos exactos (si no está como se midió, no
-- se toca). Nada en el camino del pedido. La tanda no mueve ninguna fila: borra
-- quien pulsa «Eliminar».

select public._respaldar_funcion('public.conta_puerta_dime_que_es(uuid,text,boolean,text)', '20261113T1015_s01p_documento_sin_leer');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_puerta_dime_que_es(uuid,text,boolean,text)'::regprocedure);
  v_viejo1 constant text := 'declare v_d public.document_inbox; v_from text; v_recordado boolean := false; v_que text;';
  v_nuevo1 constant text := 'declare v_d public.document_inbox; v_from text; v_recordado boolean := false; v_que text;
  -- S01p·18.2 · 3: la actividad de una persona lleva su nombre (document_activity_check).
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''''), public.conta_nombre_actor(), ''una persona'');';
  v_viejo2 constant text := 'values (v_d.account_id, v_d.company_id, p_inbox, ''persona'', p_quien_nombre, ''corregida'',';
  v_nuevo2 constant text := 'values (v_d.account_id, v_d.company_id, p_inbox, ''persona'', v_quien, ''corregida'',';
  v_v text[] := array[v_viejo1, v_viejo2];
  i int;
begin
  if strpos(v_def, 'S01p·18.2 · 3') > 0 then return; end if;   -- ya pasada
  for i in 1 .. 2 loop
    if (length(v_def) - length(replace(v_def, v_v[i], ''))) / length(v_v[i]) <> 1 then
      raise exception 'S01p·18.2 · 3: conta_puerta_dime_que_es no es la medida (el trozo % no está una sola vez): no se toca.', i;
    end if;
  end loop;
  v_def := replace(v_def, v_viejo1, v_nuevo1);
  v_def := replace(v_def, v_viejo2, v_nuevo2);
  execute v_def;
end $do$;

-- ── Eliminar un documento sin leer ───────────────────────────────────────────
-- Si se puede borrar y, si no, por qué. Lo usa la pantalla para enseñar o no el
-- botón, y conta_llegada_eliminar para no borrar nada que haya llegado a los libros.
create or replace function public.conta_llegada_eliminable(p_inbox uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_d public.document_inbox; v_que text; v_fac text; v_n int;
begin
  select * into v_d from public.document_inbox where id = p_inbox;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese documento no está.' using errcode = 'P0002'; end if;
  v_que := coalesce('«' || nullif(btrim(v_d.file_name), '') || '»', 'Este documento');
  -- Una factura: la que lo nombra (inbox_id) o la que nombra él (la leída o la repetida).
  select coalesce(si.invoice_number, 'sin número') into v_fac from public.supplier_invoice si
   where si.id in (v_d.supplier_invoice_id, v_d.duplicate_of_invoice_id) or si.inbox_id = v_d.id limit 1;
  if v_fac is not null or v_d.status in ('factura', 'repetida') then
    return jsonb_build_object('puede', false, 'porque',
      format('%s ya es la factura %s, o la repite: se quita desde su ficha («No es una factura»), que mira su asiento y sus pagos.', v_que, coalesce(v_fac, '')));
  end if;
  if v_d.ai_session_id is not null and exists (select 1 from public.goods_receipt g where g.ai_session_id = v_d.ai_session_id) then
    return jsonb_build_object('puede', false, 'porque', v_que || ' lo leyó una recepción de mercancía: se quita desde la recepción.');
  end if;
  if v_d.file_path is not null then
    select count(*) into v_n from (
      select 1 from public.document_inbox o where o.id <> v_d.id and o.file_path = v_d.file_path
      union all select 1 from public.supplier_invoice si where si.account_id = v_d.account_id and si.raw_document_url = v_d.file_path) x;
    if v_n > 0 then
      return jsonb_build_object('puede', false, 'porque', v_que || ' comparte su fichero con otro documento o una factura: no se borra.');
    end if;
  end if;
  return jsonb_build_object('puede', true, 'porque', null, 'archivo', v_d.file_name, 'bucket', v_d.file_bucket, 'ruta', v_d.file_path);
end $$;
revoke all on function public.conta_llegada_eliminable(uuid) from public, anon;
grant execute on function public.conta_llegada_eliminable(uuid) to authenticated;

-- Borra la fila, su actividad y su lectura. El fichero lo borra la pantalla antes, con la API del almacén.
create or replace function public.conta_llegada_eliminar(p_inbox uuid, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.document_inbox; v_ok jsonb; v_que text; v_act int; v_lec int := 0;
begin
  select * into v_d from public.document_inbox where id = p_inbox;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese documento no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado elimina un documento.' using errcode = '42501';
  end if;
  v_ok := public.conta_llegada_eliminable(p_inbox);
  if (v_ok->>'puede')::boolean is not true then raise exception '%', v_ok->>'porque' using errcode = '22023'; end if;
  v_que := coalesce('«' || nullif(btrim(v_d.file_name), '') || '»', 'El documento');
  delete from public.document_activity where inbox_id = p_inbox;
  get diagnostics v_act = row_count;
  delete from public.document_inbox where id = p_inbox;
  if v_d.ai_session_id is not null and not exists (select 1 from public.document_inbox o where o.ai_session_id = v_d.ai_session_id) then
    delete from public.goods_receipt_ai_session where id = v_d.ai_session_id;
    get diagnostics v_lec = row_count;
  end if;
  return jsonb_build_object('id', p_inbox, 'actividad', v_act, 'lectura', v_lec, 'bucket', v_d.file_bucket, 'ruta', v_d.file_path,
    'texto', format('Eliminado: %s. Borrados la fila de la bandeja, %s %s de su actividad%s%s.',
                    v_que, v_act, case when v_act = 1 then 'apunte' else 'apuntes' end,
                    case when v_lec > 0 then ', lo que leyó la IA' else '' end,
                    case when v_d.file_path is not null then ' y el fichero del almacén' else '' end));
end $$;
revoke all on function public.conta_llegada_eliminar(uuid, text) from public, anon;
grant execute on function public.conta_llegada_eliminar(uuid, text) to authenticated;
comment on function public.conta_llegada_eliminar(uuid, text) is
  'S01p·18.2 · 3. Borra de verdad un documento sin leer que no ha llegado a los libros (conta_llegada_eliminable): su fila, su actividad y su lectura. El fichero del almacén lo borra la pantalla con la API del almacén, antes de llamarla.';
