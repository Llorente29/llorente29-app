-- supabase/vuelta-atras/20261009T0160_c03_deshacer_importacion.down.sql
--
-- Vuelve company_chart_import_undo al texto de 20261008T0100 (literal). Ojo:
-- con party_role dentro, ese texto no deja deshacer ninguna importación con
-- fichas nuevas; esta vuelta atrás solo tiene sentido con la de la 0100 de C03.

create or replace function public.company_chart_import_undo(p_import uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  imp public.company_chart_import%rowtype;
  v_cuenta uuid; v_nombre text; fk record; n bigint; usadas text[] := '{}'; v_fichas uuid[]; n_cuentas int; n_borradas int;
begin
  select * into imp from public.company_chart_import where id = p_import for update;
  if imp.id is null then raise exception 'Esa importación no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(imp.company_id);
  v_nombre := coalesce(p_quien_nombre, public.conta_nombre_actor());
  if imp.status <> 'traida' then raise exception 'Solo se deshace un plan traído.' using errcode = '23514'; end if;
  -- Con asientos no se deshace (respuesta 1.3). Hasta el C04 no hay asientos: la guarda es la de la longitud.
  if public.company_account_length_locked(imp.company_id) then
    raise exception 'Ya hay asientos en este plan: deshacer la importación borraría su historia. No se puede.' using errcode = '23514';
  end if;
  select coalesce(array_agg(s.id), '{}') into v_fichas from public.supplier s where s.import_id = imp.id;
  if cardinality(v_fichas) > 0 then
    for fk in
      select c.conrelid::regclass::text tabla, a.attname columna
        from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.confrelid = 'public.supplier'::regclass and cardinality(c.conkey) = 1
         and c.conrelid::regclass::text not in ('supplier_contact', 'supplier_alias', 'supplier_learning', 'supplier_learning_log', 'supplier_proposal')
    loop
      execute format('select count(*) from %s where %I = any($1)', fk.tabla, fk.columna) into n using v_fichas;
      if n > 0 then usadas := usadas || format('%s en %s', n, fk.tabla); end if;
    end loop;
    if cardinality(usadas) > 0 then
      raise exception 'Alguna ficha creada al traer el plan ya se ha usado (%): deshacer la borraría. Quita antes ese uso o deja el plan como está.', array_to_string(usadas, ', ') using errcode = '23514';
    end if;
  end if;

  select count(*) into n_cuentas from public.company_account where import_id = imp.id;
  delete from public.company_account_link where company_id = imp.company_id;
  delete from public.company_account where company_id = imp.company_id;
  get diagnostics n_borradas = row_count;
  -- Las propuestas de la IA contestadas sobre este plan vuelven a poder salir.
  delete from public.ai_suggestion where company_id = imp.company_id and kind = 'plan';
  delete from public.supplier where id = any(v_fichas);
  update public.company_chart_import set status = 'deshecha', undone_at = now(), undone_by = auth.uid(), undone_by_name = v_nombre where id = imp.id;
  insert into public.company_account_log (account_id, company_id, que, detalle, antes, source, done_by, done_by_name)
  values (v_cuenta, imp.company_id, 'importacion_deshecha',
          format('Deshecho el plan traído: se quitan sus %s cuentas y %s fichas nuevas; el plan vuelve a estar sin activar.', n_cuentas, cardinality(v_fichas)),
          jsonb_build_object('importacion', imp.id, 'cuentas_borradas', n_borradas, 'fichas_borradas', cardinality(v_fichas)),
          'migrated', auth.uid(), v_nombre);
  return jsonb_build_object('cuentas', n_borradas, 'fichas', cardinality(v_fichas));
end $$;
revoke all on function public.company_chart_import_undo(uuid, text) from public, anon;
grant execute on function public.company_chart_import_undo(uuid, text) to authenticated;
