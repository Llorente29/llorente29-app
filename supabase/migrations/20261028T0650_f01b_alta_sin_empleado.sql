-- supabase/migrations/20261028T0650_f01b_alta_sin_empleado.sql
--
-- cambia: public._f01_alta_marca · prueba: supabase/staging/sql/20261027_f01b_cambios_carta_prueba.sql
--
-- F01 · PR 2 · El alta de una marca de Last falla si quien la da de alta no es
-- un empleado. Nada en el camino del pedido.
--
-- La 1320 crea la marca con brand.created_by = el usuario que pulsa «Dar de
-- alta». Pero brand.created_by es clave ajena a employees(id), y employees no
-- tiene el id del usuario ni ninguna columna que lo enlace: en producción el
-- único administrador de Foodint no está en employees (medido el 28/10, solo
-- leyendo), así que el botón fallaba con 23503 brand_created_by_fkey. Lo vio
-- la e2e del #361 (run 40645572698); ninguna prueba lo había ejecutado como
-- administrador (la de staging del #358 nunca llegó a correr, y la del #361 y la
-- unitaria llaman con p_quien null).
--
-- CAMBIA EN CALIENTE _f01_alta_marca, misma firma: la marca guarda created_by
-- solo si quien la da de alta es un empleado de la cuenta; si no, null (como
-- las 19 marcas de Foodint, que no tienen ninguno). Quién la dio de alta sigue
-- en external_brand_alta (created_by y created_by_name) y en
-- brand.created_by_name. Lo demás, byte a byte como en la 1320.
-- Se guarda antes tal cual (_respaldar_funcion) y la vuelta atrás la restaura.

select public._respaldar_funcion('public._f01_alta_marca(uuid,uuid,text,text,boolean,text,boolean,uuid,text)', '20261028T0650_f01b_alta_sin_empleado');

create or replace function public._f01_alta_marca(p_account uuid, p_org uuid, p_nombre_last text, p_nombre text,
                                                  p_propia boolean, p_socio text, p_ensayo boolean, p_quien uuid, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_last    text := btrim(coalesce(p_nombre_last, ''));
  v_nombre  text := btrim(coalesce(nullif(btrim(p_nombre), ''), p_nombre_last));
  v_socio   text := nullif(btrim(coalesce(p_socio, '')), '');
  v_brand   uuid;
  v_nueva   boolean := false;
  v_slug    text;
  v_n       integer := 1;
  v_vinc    jsonb;
  v_carta   jsonb;
  v_ventas  jsonb;
begin
  if v_last = '' then raise exception 'Falta la marca de Last.' using errcode = '22023'; end if;
  if v_nombre = '' then raise exception 'Falta el nombre de la marca.' using errcode = '22023'; end if;
  if p_propia is null then raise exception 'Falta decir si la marca es tuya o cedida.' using errcode = '22023'; end if;
  if not p_propia and v_socio is null then raise exception 'Una marca cedida necesita su socio.' using errcode = '22023'; end if;
  if not exists (select 1 from public.external_integration ei where ei.account_id = p_account and ei.source = 'lastapp'
                  and ei.external_org_id = p_org and ei.is_active) then
    raise exception 'Esa cuenta de Last no está conectada.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public._f01_filas(p_account, p_org, v_last)) then
    raise exception 'La marca «%» ya no está en las cartas de Last.', v_last using errcode = 'P0002';
  end if;

  -- La marca: la del alta, la vinculada o la que se llama igual; si no hay, una nueva.
  v_brand := coalesce(public._f01_marca_vinculada(p_account, p_org, v_last), public._f01_marca_por_nombre(p_account, v_nombre),
                      public._f01_marca_por_nombre(p_account, v_last));
  if v_brand is null then
    v_nueva := true;
    if not p_ensayo then
      v_slug := coalesce(nullif(btrim(regexp_replace(lower(public.unaccent(v_nombre)), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'marca');
      while exists (select 1 from public.brand b where b.account_id = p_account and b.slug = case when v_n = 1 then v_slug else v_slug || '-' || v_n end) loop
        v_n := v_n + 1;
      end loop;
      insert into public.brand (account_id, name, slug, ownership_type, is_active, catalog_source, created_by, created_by_name)
      values (p_account, v_nombre, case when v_n = 1 then v_slug else v_slug || '-' || v_n end,
              case when p_propia then 'own' else 'licensed' end, true, 'pos',
              -- brand.created_by apunta a employees: solo si quien da el alta es un empleado de la cuenta.
              (select e.id from public.employees e where e.id = p_quien and e.account_id = p_account), p_quien_nombre)
      returning id into v_brand;
    end if;
  elsif not p_ensayo then
    update public.brand set ownership_type = case when p_propia then 'own' else 'licensed' end, is_active = true, updated_at = now()
     where id = v_brand and (ownership_type is distinct from case when p_propia then 'own' else 'licensed' end or not is_active);
  end if;

  if not p_ensayo then
    -- De quién es: el socio de una cedida, en su ficha (el porcentaje, cuando se sepa).
    if not p_propia then
      insert into public.brand_licensing_agreement (account_id, brand_id, owner_name, revenue_share_pct, is_active, created_by, created_by_name)
      values (p_account, v_brand, v_socio, null, true, p_quien, p_quien_nombre)
      on conflict (brand_id) do update set owner_name = excluded.owner_name, is_active = true, archived_at = null, updated_at = now();
    end if;
    -- Darla de alta es usarla: si estaba entre las ocultas, deja de estarlo.
    delete from public.external_brand_oculta
     where account_id = p_account and source = 'lastapp' and external_org_id = p_org and external_brand_name = v_last;
    insert into public.external_brand_alta (account_id, source, external_org_id, external_brand_name, brand_id, created_by, created_by_name)
    values (p_account, 'lastapp', p_org, v_last, v_brand, p_quien, p_quien_nombre)
    on conflict (account_id, source, external_org_id, external_brand_name) do update set brand_id = excluded.brand_id;
  end if;

  -- En ensayo con marca nueva, v_brand es null: se lee igual (nada de la marca existe todavía).
  v_vinc  := public._f01_vincular(p_account, v_brand, p_org, v_last, p_ensayo, p_quien_nombre);
  v_carta := public._f01_sembrar_marca(p_account, v_brand, p_org, v_last, p_ensayo, p_quien_nombre);
  v_ventas := case when p_ensayo then null else public._f01_recolocar(p_account, v_brand, p_org, v_last) end;

  return jsonb_build_object(
    'brand_id', v_brand, 'nombre', v_nombre, 'nueva', v_nueva, 'propia', p_propia, 'socio', case when p_propia then null else v_socio end,
    'ensayo', p_ensayo, 'locales', coalesce(v_vinc->'locales', '[]'::jsonb), 'canales', coalesce(v_vinc->'canales', '[]'::jsonb),
    'vinculos_nuevos', coalesce((v_vinc->>'vinculos_nuevos')::integer, 0), 'vinculos_de_otra_marca', coalesce(v_vinc->'vinculos_de_otra_marca', '[]'::jsonb),
    'carta', v_carta, 'ventas', v_ventas);
end $$;
revoke all on function public._f01_alta_marca(uuid, uuid, text, text, boolean, text, boolean, uuid, text) from public, anon, authenticated;
