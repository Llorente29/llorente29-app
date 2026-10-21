-- tests/inventario/autoconteo-noche-comprobar.sql · Después de la noche de verdad, que ha acabado en error.
do $$
declare a record; b record; c record; q record; v_n int;
begin
  select * into a from public.inventory_count where code = 'J-AYER';
  select * into b from public.inventory_count where code = 'J-VACIO';
  select * into c from public.inventory_count where code = 'J-ROTO';
  select * into q from public.inventory_count where code = 'J-AUDIT';
  if a.status <> 'aprobado' or a.auto_applied_via <> 'cron' then raise exception 'JUGUETE noche: lo bueno NO ha quedado confirmado (%/%)', a.status, a.auto_applied_via; end if;
  if (select sum(qty_base) from public.stock_movement where recipe_item_id = 'aaaa0000-0000-4000-8000-000000000034') <> 4 then raise exception 'JUGUETE noche: J-AYER no ha movido el stock'; end if;
  if b.status <> 'anulado' then raise exception 'JUGUETE noche: el vacío está %', b.status; end if;
  if c.status = 'aprobado' or c.auto_apply_error not like '%roto a propósito%' or c.auto_apply_failed_at is null then raise exception 'JUGUETE noche: el roto no está apuntado (% %)', c.status, c.auto_apply_error; end if;
  select count(*) into v_n from public.system_alert_queue where debounce_kind = 'autoconteo_cierre_nocturno' and subject like '%J-ROTO%';
  if v_n <> 1 then raise exception 'JUGUETE noche: % avisos del roto', v_n; end if;
  if q.status <> 'en_revision' or q.auto_applied_via is not null then raise exception 'JUGUETE noche: ha tocado el de seguridad (%)', q.status; end if;
  select count(*) into v_n from public.inventory_count where status = 'anulado' and code like 'INV-%';
  if v_n <> 23 then raise exception 'JUGUETE noche: los anulados de la 0390 son ahora %', v_n; end if;
  select count(*) into v_n from public.autoconteo_vigia() where clave = 'sin_aplicar' and valor like '%J-ROTO%con fallo%';
  if v_n <> 1 then raise exception 'JUGUETE: el vigía no ve el roto'; end if;
  raise notice 'JUGUETE noche: J-AYER confirmado aunque la noche acabó en error; J-VACIO anulado; J-ROTO apuntado con su aviso; el de seguridad intacto.';
end $$;
