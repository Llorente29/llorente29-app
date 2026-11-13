-- supabase/migrations/20261113T1015_s01p_documento_sin_leer.sql
--
-- S01p·18.2 · punto 3 (= S01p·18, punto 5; Julio, 13/11). En «Por aclarar», la
-- ventana del documento sin leer:
--
--   · «No es una factura» daba error: conta_puerta_dime_que_es apunta su
--     actividad como 'persona' con p_quien_nombre, y cuando la pantalla no sabe
--     el nombre llega vacío; document_activity_check exige el nombre de la
--     persona («document_activity_check»). Ahora, si no llega, el de la sesión
--     (conta_nombre_actor) y, si tampoco, «una persona».
--   · No se podía eliminar un documento: hay tres esperando en Foodint (los dos
--     «Compras-y-Ventas» del socio y EMPRESARIAL-COLON.pdf, medidos el 13/11,
--     los tres en error de lectura). conta_llegada_eliminar lo aparta: pasa a
--     «descartado» (sale de «Por aclarar» y de todas las listas), con quién y
--     cuándo en su actividad. No borra el fichero ni la fila: se puede ver en su
--     historial.
--
-- cambia: public.conta_puerta_dime_que_es · prueba: supabase/staging/sql/20261113_s01p_documento_sin_leer_prueba.sql
--
-- La de antes, con respaldo; dos reemplazos exactos (si no está como se midió, no
-- se toca). Nada en el camino del pedido. No mueve ninguna fila.

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
create or replace function public.conta_llegada_eliminar(p_inbox uuid, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.document_inbox; v_quien text; v_que text;
begin
  select * into v_d from public.document_inbox where id = p_inbox;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese documento no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado elimina un documento.' using errcode = '42501';
  end if;
  v_que := coalesce('«' || nullif(btrim(v_d.file_name), '') || '»', 'El documento');
  if v_d.status = 'descartado' then
    return jsonb_build_object('id', p_inbox, 'ya_estaba', true, 'texto', v_que || ' ya estaba eliminado.');
  end if;
  if v_d.supplier_invoice_id is not null or v_d.status in ('factura', 'repetida') then
    raise exception '% ya es una factura: elimínala desde su ficha («No es una factura»), no desde aquí.', v_que using errcode = '22023';
  end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  update public.document_inbox
     set status = 'descartado', updated_at = now(),
         reason = format('Eliminado por %s el %s.', v_quien, to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY'))
   where id = p_inbox;
  insert into public.document_activity (account_id, company_id, inbox_id, actor, actor_name, action, text, detail)
  values (v_d.account_id, v_d.company_id, p_inbox, 'persona', v_quien, 'descartada',
          v_que || ' eliminado: sale de «Por aclarar».', jsonb_build_object('antes', v_d.status, 'archivo', v_d.file_name));
  return jsonb_build_object('id', p_inbox, 'ya_estaba', false,
    'texto', 'Eliminado: ' || v_que || '. Ya no sale en «Por aclarar»; queda en su historial.');
end $$;
revoke all on function public.conta_llegada_eliminar(uuid, text) from public, anon;
grant execute on function public.conta_llegada_eliminar(uuid, text) to authenticated;
comment on function public.conta_llegada_eliminar(uuid, text) is
  'S01p·18.2 · 3. Elimina (aparta) un documento sin leer de la bandeja: pasa a «descartado», con quién y cuándo en su actividad. No borra el fichero ni la fila. Una llegada que ya es factura se elimina desde su ficha.';
