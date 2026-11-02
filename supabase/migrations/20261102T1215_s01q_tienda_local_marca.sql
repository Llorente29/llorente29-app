-- supabase/migrations/20261102T1215_s01q_tienda_local_marca.sql
-- cambia: public.conta_local_de_tienda · prueba: supabase/staging/sql/20261102_s01q_tienda_prueba.sql
-- cambia: public._conta_tienda_local_por_direccion · prueba: supabase/staging/sql/20261102_s01q_tienda_prueba.sql
--
-- S01q · La tienda de la plataforma es la unidad (Julio, 02/11, respuesta 1).
-- De qué local y de qué marca es una tienda se decide una vez por tienda, en
-- este orden, para cualquier cliente:
--   1. lo confirmado para esa tienda (lo que ya tiene puesto: el disparador solo
--      rellena lo que está vacío, y «Sus tiendas» lo cambia a mano);
--   2. la etiqueta de su nombre, la que pone la plataforma entre «- MAD -» y la
--      dirección («Meraki Pita - MAD - Camichi 4 (…)» → Camichi 4 → Carabanchel).
--      Si hay etiqueta y no casa con un solo local, la tienda queda SIN local
--      («Tienda sin local»): la dirección de esas tiendas no es de fiar (Glovo no
--      la actualiza);
--   3. sin etiqueta, la dirección, con las otras direcciones del local (S01m).
-- La marca, por su nombre contra las marcas de la cuenta (una sola, o ninguna).
-- Misma firma que las de antes, con su respaldo.

-- La etiqueta: lo de entre «- XXX -» y la dirección entre paréntesis del final.
create or replace function public._conta_tienda_etiqueta(p_texto text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(substring(coalesce(p_texto, '') from '\s-\s[A-Z]{2,4}\s-\s(.*?)\s*\([^()]*\)\s*$')), '')
$$;
comment on function public._conta_tienda_etiqueta(text) is 'S01q · La etiqueta del nombre de una tienda de plataforma («Marca - MAD - Camichi 4 (dirección)» → «Camichi 4»), o null.';

-- La marca de una tienda por su nombre: sin «S.L.», sin la etiqueta ni la
-- dirección, sin acentos y sin la «s» del final. Una sola marca de la cuenta, o null.
create or replace function public._conta_clave_marca(p_texto text)
returns text language sql stable set search_path = public as $$
  select nullif(regexp_replace(regexp_replace(lower(public.unaccent(replace(replace(coalesce(p_texto, ''), '´', ''''), '’', ''''))), '[^a-z0-9]+', '', 'g'), 's$', ''), '')
$$;

create or replace function public.conta_marca_de_tienda(p_account uuid, p_texto text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_nombre text; v_clave text; v_ids uuid[];
begin
  if p_account is null or p_texto is null then return null; end if;
  v_nombre := regexp_replace(p_texto, '^\s*S\.?\s*L\.?\s+', '', 'i');
  v_nombre := regexp_replace(v_nombre, '\s+-\s+[A-Z]{2,4}\s+-\s+.*$', '');
  v_nombre := regexp_replace(v_nombre, '\s*\(.*$', '');
  v_clave := public._conta_clave_marca(v_nombre);
  if v_clave is null then return null; end if;
  select array_agg(b.id) into v_ids from public.brand b
   where b.account_id = p_account and b.archived_at is null and public._conta_clave_marca(b.name) = v_clave;
  if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  if coalesce(array_length(v_ids, 1), 0) > 1 then return null; end if;
  -- Ninguna igual: una sola cuyo nombre empieza por el de la tienda («Smash Brothers» → «Smash Brothers Burgers»).
  if length(v_clave) < 6 then return null; end if;
  select array_agg(b.id) into v_ids from public.brand b
   where b.account_id = p_account and b.archived_at is null and public._conta_clave_marca(b.name) like v_clave || '%';
  if coalesce(array_length(v_ids, 1), 0) <> 1 then return null; end if;
  return v_ids[1];
end $$;
revoke all on function public.conta_marca_de_tienda(uuid, text) from public, anon;
grant execute on function public.conta_marca_de_tienda(uuid, text) to authenticated, service_role;
comment on function public.conta_marca_de_tienda(uuid, text) is 'S01q · La marca de una tienda de plataforma por su nombre («S.L.  Meraki Pita - MAD - Camichi 4 (…)» → Meraki Pita): una sola marca de la cuenta con ese nombre, o null.';

select public._respaldar_funcion('public.conta_local_de_tienda(uuid,text)', '20261102T1215_s01q_tienda_local_marca');
create or replace function public.conta_local_de_tienda(p_account uuid, p_texto text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_etiqueta text; v_dir text; v_clave text; v_ids uuid[];
begin
  if p_account is null or p_texto is null then return null; end if;
  -- S01q · 2. La etiqueta manda sobre la dirección. Si no casa con un solo local, sin local.
  v_etiqueta := public._conta_tienda_etiqueta(p_texto);
  if v_etiqueta is not null then
    return public._conta_local_de_texto(p_account, array[v_etiqueta]);
  end if;
  -- 3. La dirección va entre los últimos paréntesis: «Marca (Calle …, Madrid, ES, 28027)».
  -- Sin paréntesis, el texto entero. Con las otras direcciones del local (S01m).
  v_dir := coalesce(substring(p_texto from '\(([^()]*)\)\s*$'), p_texto);
  v_ids := array_remove(array[public._conta_local_de_texto(p_account, array[split_part(v_dir, ',', 1)])], null);
  if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  -- Como antes: la dirección exacta de un solo local.
  v_clave := public.conta_clave_direccion(split_part(v_dir, ',', 1));
  if v_clave is null then return null; end if;
  select array_agg(l.id) into v_ids from public.locations l
   where l.account_id = p_account and public.conta_clave_direccion(l.address) = v_clave;
  if coalesce(array_length(v_ids, 1), 0) <> 1 then return null; end if;
  return v_ids[1];
end $$;

select public._respaldar_funcion('public._conta_tienda_local_por_direccion()', '20261102T1215_s01q_tienda_local_marca');
create or replace function public._conta_tienda_local_por_direccion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.external_text is null then return new; end if;
  -- S01q · La marca, por su nombre, si no la trae.
  if new.brand_id is null then
    new.brand_id := public.conta_marca_de_tienda(new.account_id, new.external_text);
  end if;
  if new.location_id is not null then return new; end if;
  new.location_id := public.conta_local_de_tienda(new.account_id, new.external_text);
  if new.location_id is null then
    -- Avisa, pero nunca impide que entre la liquidación.
    begin
      perform public.encolar_alerta(
        p_kind            => 'tienda_sin_local',
        p_subject         => 'Una tienda de plataforma no casa con ningún local',
        p_message         => format('La tienda «%s» (%s) ha llegado y no sé de qué local es. Sus liquidaciones salen como «Tienda sin local» en Ventas › Liquidaciones hasta que se lo digas.',
                                    new.external_text, coalesce(new.provider, 'plataforma')),
        p_debounce_kind   => 'tienda_sin_local:' || new.account_id::text || ':' || md5(new.external_text),
        p_debounce_window => interval '7 days',
        p_account_id      => new.account_id,
        p_severity        => 'aviso');
    exception when others then
      raise notice 'tienda_sin_local: no se pudo encolar el aviso (%)', sqlerrm;
    end;
  end if;
  return new;
end $$;
