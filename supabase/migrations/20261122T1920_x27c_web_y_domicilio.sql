-- supabase/migrations/20261122T1920_x27c_web_y_domicilio.sql
--
-- X27c · La ficha, fiel a ERP10 (respuesta X27 · 1, 22/11). SOLO AÑADE: no escribe en ninguna fila.
--   1. customer_fiscal.website: «Página web» de la ficha del cliente (la del proveedor ya existía: supplier.website).
--   2. _x27c_provincia_de_cp(cp): la provincia de un código postal español por sus dos primeras cifras (01–52), en
--      mayúsculas como las escribe ERP10 («MADRID», «BARCELONA»). Null si no es un código postal español.
--   3. _x27c_partir_domicilio(texto): parte un domicilio escrito en una línea («C/ Mayor, 5, 28013 Madrid», «Avda. X 12,
--      Madrid») en calle, código postal, población y provincia. Con código postal: la población es lo que le sigue (sin
--      la provincia entre paréntesis ni lo que va tras una coma) y la provincia, la de su código. Sin él: si el último
--      trozo tras una coma no lleva cifras y tiene como mucho cuatro palabras, es la población (y la provincia, si se
--      llama como una). Lo que no se sabe partir se queda entero en la calle.
-- La 1921 (cambia: public.supplier) las usa al dar de alta un proveedor. La «Subcuenta suplidos» ya tenía dónde
-- guardarse (company_account_link, rol «suplidos», C02).
-- Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261122T1920_x27c_web_y_domicilio.down.sql (después de la de la 1921)

alter table public.customer_fiscal add column if not exists website text;
comment on column public.customer_fiscal.website is 'X27c · «Página web» de la ficha del cliente.';

create or replace function public._x27c_provincia_de_cp(p_cp text)
returns text language sql immutable set search_path = public as $$
  select (array['ARABA/ÁLAVA','ALBACETE','ALICANTE','ALMERÍA','ÁVILA','BADAJOZ','ILLES BALEARS','BARCELONA','BURGOS','CÁCERES',
                'CÁDIZ','CASTELLÓN','CIUDAD REAL','CÓRDOBA','A CORUÑA','CUENCA','GIRONA','GRANADA','GUADALAJARA','GIPUZKOA',
                'HUELVA','HUESCA','JAÉN','LEÓN','LLEIDA','LA RIOJA','LUGO','MADRID','MÁLAGA','MURCIA',
                'NAVARRA','OURENSE','ASTURIAS','PALENCIA','LAS PALMAS','PONTEVEDRA','SALAMANCA','SANTA CRUZ DE TENERIFE','CANTABRIA','SEGOVIA',
                'SEVILLA','SORIA','TARRAGONA','TERUEL','TOLEDO','VALENCIA','VALLADOLID','BIZKAIA','ZAMORA','ZARAGOZA',
                'CEUTA','MELILLA'])[left(btrim(p_cp), 2)::int]
   where btrim(coalesce(p_cp, '')) ~ '^(0[1-9]|[1-4][0-9]|5[0-2])[0-9]{3}$'
$$;
comment on function public._x27c_provincia_de_cp(text) is 'X27c · La provincia de un código postal español (01–52), en mayúsculas como ERP10. Null si no lo es.';

create or replace function public._x27c_partir_domicilio(p_texto text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  t text := nullif(btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g')), '');
  m text[]; v_calle text; v_cp text; v_ciudad text; v_prov text; v_ult text; v_resto text;
begin
  if t is null then return jsonb_build_object('calle', null, 'cp', null, 'ciudad', null, 'provincia', null); end if;
  m := regexp_match(t, '^(.*?)[,\s-]*\m((?:0[1-9]|[1-4][0-9]|5[0-2])[0-9]{3})\M[,\s-]*(.*)$');
  if m is not null then
    v_calle := nullif(btrim(regexp_replace(m[1], '[,\s-]+$', '')), '');
    v_cp := m[2];
    v_ciudad := nullif(btrim(regexp_replace(split_part(regexp_replace(m[3], '\(.*?\)', '', 'g'), ',', 1), '[\s-]+$', '')), '');
    v_prov := public._x27c_provincia_de_cp(v_cp);
  else
    v_ult := btrim(regexp_replace(t, '^.*,', ''));
    v_resto := btrim(regexp_replace(t, ',[^,]*$', ''));
    if position(',' in t) > 0 and v_ult <> '' and v_ult !~ '[0-9]' and array_length(regexp_split_to_array(v_ult, '\s+'), 1) <= 4 and v_resto <> '' then
      v_calle := v_resto; v_ciudad := v_ult;
      v_prov := (select p from unnest(array['MADRID','BARCELONA','VALENCIA','SEVILLA','MÁLAGA','ZARAGOZA','MURCIA','ALICANTE','CÓRDOBA',
                  'VALLADOLID','GRANADA','TOLEDO','SALAMANCA','BURGOS','LEÓN','CÁDIZ','HUELVA','JAÉN','ALMERÍA','GIRONA','LLEIDA',
                  'TARRAGONA','CASTELLÓN','ALBACETE','CUENCA','GUADALAJARA','SEGOVIA','ÁVILA','SORIA','PALENCIA','ZAMORA','TERUEL',
                  'HUESCA','BADAJOZ','CÁCERES','LUGO','OURENSE','PONTEVEDRA','CANTABRIA','ASTURIAS','NAVARRA','LA RIOJA','CEUTA','MELILLA']) p
                  where translate(upper(p), 'ÁÉÍÓÚÜÀÈÒ', 'AEIOUUAEO') = translate(upper(v_ult), 'ÁÉÍÓÚÜÀÈÒ', 'AEIOUUAEO') limit 1);
    else
      v_calle := t;
    end if;
  end if;
  return jsonb_build_object('calle', v_calle, 'cp', v_cp, 'ciudad', v_ciudad, 'provincia', v_prov);
end $$;
comment on function public._x27c_partir_domicilio(text) is
  'X27c · Un domicilio en una línea partido en calle, código postal, población y provincia (la del código postal; sin él, la que se llama como la población). Lo que no se sabe partir, entero en la calle.';
