do $edita$
declare
  v_src text;
  v_new text;
  v_a1 constant text := 'count(*)::integer as items, min(r.entity_at) as oldest_at';
  v_a2 constant text := 'c.items, jsonb_build_object(''oldest_at'', c.oldest_at), k.sort_weight';
begin
  v_src := pg_get_functiondef('public.pending_board(uuid)'::regprocedure);

  if position('items_recientes' in v_src) > 0 then
    raise notice 'pending_board ya expone items_recientes, se salta';
    return;
  end if;
  if position(v_a1 in v_src) = 0 or position(v_a2 in v_src) = 0 then
    raise exception 'no se encuentran las anclas en pending_board: la funcion ha cambiado y hay que revisar esta migracion';
  end if;

  v_new := replace(v_src, v_a1,
    v_a1 || ', max(r.entity_at) as newest_at' ||
    ', count(*) filter (where r.entity_at > now() - interval ''7 days'')::integer as items_recientes');

  v_new := replace(v_new, v_a2,
    'c.items, jsonb_build_object(''oldest_at'', c.oldest_at, ''newest_at'', c.newest_at, ''items_recientes'', c.items_recientes), k.sort_weight');

  execute v_new;

  v_src := pg_get_functiondef('public.pending_board(uuid)'::regprocedure);
  if position('items_recientes' in v_src) = 0 or position('newest_at' in v_src) = 0 then
    raise exception 'la edicion de pending_board no quedo aplicada';
  end if;
  raise notice 'pending_board expone newest_at e items_recientes';
end;
$edita$;

do $verif$
declare v_n int; v_src text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='pending_board';
  if v_n <> 1 then
    raise exception 'pending_board tiene % firmas: se ha creado una sobrecarga (Regla 2)', v_n;
  end if;

  v_src := pg_get_functiondef('public.pending_board(uuid)'::regprocedure);

  if position('''oldest_at'', c.oldest_at' in v_src) = 0 then
    raise exception 'se ha perdido oldest_at del detail';
  end if;
  if position('count(*)::integer as items' in v_src) = 0 then
    raise exception 'se ha tocado el conteo total de items';
  end if;

  raise notice 'VERIFICACION OK: pending_board suma newest_at e items_recientes y conserva items y oldest_at';
end;
$verif$;
