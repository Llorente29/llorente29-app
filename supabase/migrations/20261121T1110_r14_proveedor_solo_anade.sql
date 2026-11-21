-- supabase/migrations/20261121T1110_r14_proveedor_solo_anade.sql
--
-- R14 · El proveedor nuevo se da de alta solo, con su cuenta de gasto. 1 de 3: lo que
-- SOLO AÑADE (tablas y funciones nuevas; nada de lo que existe cambia).
--
--   1. conta_gasto_por_venta: la tabla de «por lo que vende» → su cuenta de gasto, en un
--      solo sitio. Cada fila, una hoja del plan y sus palabras (con tilde, como se leen;
--      se comparan sin tildes y en minúsculas, palabra entera o su plural).
--   2. _conta_gasto_por_venta(textos): de las líneas de una factura, la hoja que más
--      líneas reconoce (cada línea, a la primera fila que la reconoce) y sus palabras.
--   3. conta_gasto_propuesto(empresa, proveedor, factura): la cuenta de gasto propuesta
--      desde la primera factura, con su porqué: la plataforma (su comisión, 623); la de
--      sus facturas en otra sociedad de la cuenta; o la de lo que vende.
--   4. conta_proveedor_solo: lo que Sumied ha hecho (o no, y por qué) con el proveedor de
--      cada recibida leída. Una fila por factura.
--   5. _conta_proveedor_solo(factura): el alta sola. Con el NIF leído:
--        · el de la propia empresa, ninguno o uno que no valida → no se da de alta (motivo);
--        · el de una plataforma de la cuenta → su ficha de proveedor (la crea en su mismo
--          tercero si no la tiene) y su 410;
--        · el de un proveedor de la cuenta (de esta u otra sociedad) → ese, el mismo tercero;
--        · si no, un proveedor nuevo con lo leído (nombre, NIF, dirección, correo, teléfono
--          y web) y su subcuenta: la siguiente libre de la 4000 o de la 4100, con la misma
--          regla que «Darlo de alta» (hojaDelProveedor: compras del 60 → 4000; lo demás → 4100).
--      Lo validado no se toca.
--   6. conta_proveedor_solo_deshacer(factura): «Deshacer». La factura vuelve a no tener
--      proveedor; si el proveedor lo dio de alta Sumied y no tiene nada más, se va, con su
--      subcuenta (si no tiene apuntes).
-- El disparador que lo llama al leer va en la 1120 (cambia supplier_invoice); completar
-- las ya leídas, en la 1130 (con autorizo). Se puede pasar dos veces.
-- Vuelta atrás: supabase/vuelta-atras/20261121T1110_r14_proveedor_solo_anade.down.sql

-- 1 · La tabla de lo que vende ---------------------------------------------------------------------
create table if not exists public.conta_gasto_por_venta (
  orden    int primary key,
  hoja     text not null check (hoja ~ '^6[0-9]{2}$'),
  que      text not null check (length(btrim(que)) > 0),
  palabras text[] not null check (cardinality(palabras) > 0),
  porque   text check (porque is null or length(btrim(porque)) > 0)
);
-- Julio, 21/11: el porqué propio de una fila, en una línea («Combustible para la cocina: 602»).
alter table public.conta_gasto_por_venta add column if not exists porque text check (porque is null or length(btrim(porque)) > 0);
comment on table public.conta_gasto_por_venta is
  'R14. Por lo que vende un proveedor (las líneas de su factura), la hoja del 6 de su gasto. Cada línea va a la primera fila (por orden) que tenga una de sus palabras; gana la hoja con más líneas. Las palabras, con tilde; se comparan sin tildes ni mayúsculas, enteras o en plural. Probada contra los nombres reales (regla 31) en el parte del R14.';
alter table public.conta_gasto_por_venta enable row level security;
drop policy if exists conta_gasto_por_venta_leer on public.conta_gasto_por_venta;
create policy conta_gasto_por_venta_leer on public.conta_gasto_por_venta for select to authenticated using (true);
revoke all on table public.conta_gasto_por_venta from anon, authenticated;
grant select on table public.conta_gasto_por_venta to authenticated;

-- Julio, 21/11: el combustible que se almacena (carbón, leña, briquetas, pastillas de
-- encendido, gas en bombona) es 602, no 600 ni 628; la 628, solo lo que no se almacena
-- (luz, agua, gas canalizado). Va antes que la 628: «gas en bombona» no es suministro.
insert into public.conta_gasto_por_venta (orden, hoja, que, palabras, porque) values
  (5, '602', 'combustible para la cocina', array['carbón', 'carbón vegetal', 'leña', 'briqueta', 'briquetas', 'pastillas de encendido', 'pastilla de encendido', 'encendedores', 'gas en bombona', 'bombona', 'bombonas', 'butano', 'propano'], 'Combustible para la cocina: 602'),
  (10, '628', 'luz, agua y gas', array['electricidad', 'eléctrica', 'eléctrico', 'energía', 'kwh', 'potencia contratada', 'término de potencia', 'término de energía', 'término fijo', 'término variable', 'peaje de acceso', 'gas natural', 'gas canalizado', 'consumo de agua', 'agua potable', 'canon de agua', 'saneamiento', 'alcantarillado', 'suministro eléctrico', 'suministro de agua', 'suministro de gas'], null),
  (20, '621', 'el alquiler', array['alquiler', 'arrendamiento', 'renta del local', 'renta mensual', 'renting'], null),
  (30, '623', 'asesoría', array['asesoría', 'asesoramiento', 'gestoría', 'honorarios', 'abogado', 'abogados', 'notaría', 'notario', 'consultoría', 'auditoría', 'nóminas', 'contabilidad'], null),
  (40, '622', 'reparaciones y mantenimiento', array['reparación', 'mantenimiento', 'avería', 'mano de obra', 'desplazamiento', 'fontanería', 'electricista', 'cerrajería', 'revisión técnica'], null),
  (50, '625', 'seguros', array['seguro', 'póliza', 'prima de seguro'], null),
  (60, '624', 'transporte', array['transporte', 'portes', 'mensajería', 'paquetería'], null),
  (70, '627', 'publicidad', array['publicidad', 'marketing', 'anuncio', 'anuncios', 'flyers', 'folletos', 'cartelería'], null),
  (80, '629', 'teléfono, internet y programas', array['telefonía', 'teléfono', 'móvil', 'fibra', 'internet', 'software', 'licencia', 'suscripción', 'hosting', 'dominio'], null),
  (90, '602', 'productos de limpieza', array['lejía', 'detergente', 'desengrasante', 'friegasuelos', 'fregasuelos', 'jabón', 'lavavajillas', 'limpiador', 'abrillantador', 'bayeta', 'bayetas', 'estropajo', 'desinfectante', 'amoniaco'], null),
  (100, '600', 'comida y bebida para la cocina', array['pollo', 'alitas', 'alita', 'pechuga', 'muslo', 'contramuslo', 'carne', 'ternera', 'cerdo', 'cordero', 'vacuno', 'hamburguesa', 'burger', 'bacon', 'beicon', 'jamón', 'chorizo', 'salchicha', 'pescado', 'salmón', 'atún', 'gamba', 'langostino', 'calamar', 'verdura', 'fruta', 'tomate', 'lechuga', 'cebolla', 'patata', 'patatas', 'pimiento', 'ajo', 'limón', 'naranja', 'aguacate', 'pan', 'harina', 'arroz', 'pasta', 'queso', 'leche', 'nata', 'mantequilla', 'huevo', 'huevos', 'yogur', 'aceite', 'azúcar', 'especias', 'salsa', 'ketchup', 'mayonesa', 'mostaza', 'vinagre', 'pizza', 'refresco', 'cerveza', 'vino', 'agua mineral', 'zumo', 'café', 'bebida', 'congelado', 'kg', 'kilo', 'kilos'], null),
  (110, '602', 'envases y desechables', array['envase', 'desechable', 'servilleta', 'vaso', 'pajita', 'film', 'aluminio', 'guante', 'guantes', 'bandeja', 'cubierto', 'cubiertos', 'tarrina', 'barqueta', 'recipiente', 'tapa', 'bolsa', 'packaging', 'kraft', 'cartón', 'papel', 'rollo'], null)
on conflict (orden) do update set hoja = excluded.hoja, que = excluded.que, palabras = excluded.palabras, porque = excluded.porque;

-- 2 · Por lo que vende ----------------------------------------------------------------------------
create or replace function public._r14_sin_tildes(p text)
returns text language sql immutable as $function$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'áéíóúüàèìòùâêîôûñç', 'aeiouuaeiouaeiounc'), '[^a-z0-9]+', ' ', 'g'))
$function$;
comment on function public._r14_sin_tildes(text) is 'R14: un texto como se compara con conta_gasto_por_venta: minúsculas, sin tildes y solo letras y cifras separadas por un espacio.';

create or replace function public._conta_gasto_por_venta(p_textos text[])
returns jsonb language sql stable set search_path = public as $function$
  with l as (
    select ' ' || public._r14_sin_tildes(t) || ' ' as t, o from unnest(coalesce(p_textos, '{}')) with ordinality as x(t, o)
     where btrim(coalesce(t, '')) <> ''
  ), casa as (
    -- Cada línea, a la primera fila que la reconoce, con las palabras que tiene.
    select distinct on (l.o) l.o, g.orden, g.hoja, g.que, g.porque,
           array(select w from unnest(g.palabras) with ordinality as p(w, k)
                  where l.t like '% ' || public._r14_sin_tildes(w) || ' %' or l.t like '% ' || public._r14_sin_tildes(w) || 's %'
                     or l.t like '% ' || public._r14_sin_tildes(w) || 'es %' order by k) as ws
      from l join public.conta_gasto_por_venta g
        on exists (select 1 from unnest(g.palabras) w
                    where l.t like '% ' || public._r14_sin_tildes(w) || ' %' or l.t like '% ' || public._r14_sin_tildes(w) || 's %'
                       or l.t like '% ' || public._r14_sin_tildes(w) || 'es %')
     order by l.o, g.orden
  ), por_hoja as (
    select hoja, min(orden) as orden, (array_agg(que order by orden))[1] as que, (array_agg(porque order by orden))[1] as porque, count(*) as lineas
      from casa group by hoja
  ), ws as (
    -- Las palabras de cada hoja, por dónde salen primero; sin la misma en singular y en plural.
    select c.hoja, u.w, public._r14_sin_tildes(u.w) as n, min(c.o * 1000 + u.k) as pos
      from casa c cross join lateral unnest(c.ws) with ordinality as u(w, k) group by c.hoja, u.w
  )
  select case when h.hoja is null then null else jsonb_build_object(
           'hoja', h.hoja, 'que', h.que, 'porque', h.porque, 'lineas', h.lineas, 'de', (select count(*) from l),
           'palabras', coalesce((select jsonb_agg(z.w order by z.pos) from (
              select x.w, x.pos from ws x
               where x.hoja = h.hoja and not exists (select 1 from ws y where y.hoja = x.hoja and y.pos < x.pos
                       and (y.n || 's' = x.n or y.n || 'es' = x.n or x.n || 's' = y.n or x.n || 'es' = y.n))
               order by x.pos limit 2) z), '[]'::jsonb)) end
    from (select * from por_hoja order by lineas desc, orden limit 1) h
$function$;
comment on function public._conta_gasto_por_venta(text[]) is 'R14: de las líneas de una factura, la hoja del 6 que más líneas reconoce en conta_gasto_por_venta, con qué vende y sus dos primeras palabras. null si no reconoce ninguna.';

-- 3 · La cuenta de gasto propuesta -----------------------------------------------------------------
create or replace function public._conta_gasto_propuesto(p_company uuid, p_supplier uuid, p_invoice uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_acc uuid; v_rol public.party_role; v_party text; v_cuenta text; v_nombre text; v_x record; v_g jsonb; v_textos text[];
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then return jsonb_build_object('cuenta', null, 'porque', 'Esa empresa no está.'); end if;
  if not exists (select 1 from public.supplier s where s.id = p_supplier and s.account_id = v_acc) then
    return jsonb_build_object('cuenta', null, 'porque', 'Ese proveedor no es de esta cuenta.');
  end if;

  -- a · Una plataforma de reparto: su comisión (la de su papel, o la 623).
  select pr.* into v_rol from public.party_role ps join public.party_role pr on pr.party_id = ps.party_id and pr.role = 'platform'
   where ps.supplier_id = p_supplier and ps.role = 'supplier' limit 1;
  if v_rol.id is not null then
    select name into v_party from public.party where id = v_rol.party_id;
    -- La comisión de su papel, si la base la tiene (party_role.commission_account_code, de la 1113 del D01):
    -- leída por jsonb, para que no falle donde la columna no esté.
    v_cuenta := coalesce(nullif(btrim(to_jsonb(v_rol)->>'commission_account_code'), ''), public._conta_hoja(p_company, '623'));
    if v_cuenta is not null then
      select name into v_nombre from public.company_account where company_id = p_company and code = v_cuenta;
      return jsonb_build_object('cuenta', v_cuenta, 'nombre', v_nombre, 'de', 'plataforma',
        'porque', format('Propuesta: %s es una plataforma de reparto; su factura es su comisión → %s %s', v_party, v_cuenta, coalesce(v_nombre, '')));
    end if;
  end if;

  -- b · Sus facturas en otra sociedad de la cuenta: la cuenta de la más reciente.
  select e.company_id, c.legal_name, a.template_code, a.code, count(*) over (partition by e.company_id) as n
    into v_x
    from public.journal_entry e
    join public.company c on c.id = e.company_id
    join public.company_account_link k on k.company_id = e.company_id and k.entity = 'supplier' and k.entity_id = p_supplier::text and k.role = 'principal'
    join public.journal_line lp on lp.entry_id = e.id and lp.company_account_id = k.company_account_id and lp.credit > 0
    join public.journal_line lg on lg.entry_id = e.id and lg.debit > 0
    join public.company_account a on a.id = lg.company_account_id and a.code like '6%'
   where e.account_id = v_acc and e.company_id <> p_company and e.series = 2 and e.status = 'validado'
   order by e.entry_date desc, e.created_at desc limit 1;
  if v_x.company_id is not null then
    v_cuenta := coalesce((select code from public.company_account where company_id = p_company and code = v_x.code and status = 'activa'),
                         public._conta_hoja(p_company, v_x.template_code));
    if v_cuenta is not null then
      select name into v_nombre from public.company_account where company_id = p_company and code = v_cuenta;
      return jsonb_build_object('cuenta', v_cuenta, 'nombre', v_nombre, 'de', 'otra_sociedad',
        'porque', format('Propuesta: en %s sus facturas van a la %s → %s %s', v_x.legal_name, v_x.code, v_cuenta, coalesce(v_nombre, '')));
    end if;
  end if;

  -- c · Por lo que vende: las líneas de esta factura (o, sin factura, las de su última).
  select array_agg(l.raw_text order by l.position) into v_textos
    from public.supplier_invoice_line l
   where l.supplier_invoice_id = coalesce(p_invoice, (select i.id from public.supplier_invoice i where i.supplier_id = p_supplier and i.account_id = v_acc order by i.created_at desc limit 1));
  v_g := public._conta_gasto_por_venta(v_textos);
  if v_g is not null then
    v_cuenta := public._conta_hoja(p_company, v_g->>'hoja');
    if v_cuenta is not null then
      select coalesce(p.name, a.name) into v_nombre from public.company_account a
        left join public.pgc_account p on p.plan = a.plan and p.code = a.template_code and p.valid_to is null
       where a.company_id = p_company and a.code = v_cuenta;
      return jsonb_build_object('cuenta', v_cuenta, 'nombre', v_nombre, 'de', 'lo_que_vende', 'hoja', v_g->>'hoja', 'que', v_g->>'que',
        'porque', coalesce(v_g->>'porque', format('Propuesta: vende %s → %s %s', public._conta_tpv_lista(array(select jsonb_array_elements_text(v_g->'palabras'))), v_g->>'hoja', coalesce(v_nombre, ''))));
    end if;
  end if;
  return jsonb_build_object('cuenta', null, 'porque', 'No sé qué te vende: elige tú la cuenta de gasto.');
end $function$;
comment on function public._conta_gasto_propuesto(uuid, uuid, uuid) is 'R14: lo de conta_gasto_propuesto, sin mirar quién llama (lo usa el alta sola).';
revoke all on function public._conta_gasto_propuesto(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.conta_gasto_propuesto(p_company uuid, p_supplier uuid, p_invoice uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  return public._conta_gasto_propuesto(p_company, p_supplier, p_invoice);
end $function$;
comment on function public.conta_gasto_propuesto(uuid, uuid, uuid) is 'R14: la cuenta de gasto propuesta para un proveedor sin historial en esta empresa, con su porqué: plataforma (su comisión), sus facturas en otra sociedad de la cuenta, o lo que vende (conta_gasto_por_venta). Se enseña en ámbar.';
revoke all on function public.conta_gasto_propuesto(uuid, uuid, uuid) from public, anon;
grant execute on function public.conta_gasto_propuesto(uuid, uuid, uuid) to authenticated, service_role;

-- 4 · Lo que Sumied ha hecho con el proveedor de cada recibida -------------------------------------
create table if not exists public.conta_proveedor_solo (
  invoice_id       uuid primary key references public.supplier_invoice(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid references public.company(id) on delete cascade,
  que              text not null check (que in ('alta', 'existente', 'plataforma', 'no')),
  supplier_id      uuid references public.supplier(id) on delete set null,
  supplier_creado  boolean not null default false,
  cuenta_id        uuid references public.company_account(id) on delete set null,
  cuenta_creada    boolean not null default false,
  motivo           text,
  nif              text,
  cuando           text not null default 'al_leer' check (cuando in ('al_leer', 'al_aplicar')),
  created_at       timestamptz not null default now(),
  deshecho_at      timestamptz,
  deshecho_por     text,
  check ((que = 'no') = (supplier_id is null and motivo is not null) or deshecho_at is not null)
);
comment on table public.conta_proveedor_solo is
  'R14. El proveedor de cada recibida leída: si Sumied lo dio de alta solo (alta), lo encontró (existente) o era una plataforma, con lo que creó; o por qué no (no, con su motivo). La franja de la ficha y «Deshacer» salen de aquí.';
create index if not exists idx_conta_proveedor_solo_cuenta on public.conta_proveedor_solo (account_id, company_id);
alter table public.conta_proveedor_solo enable row level security;
drop policy if exists conta_proveedor_solo_leer on public.conta_proveedor_solo;
create policy conta_proveedor_solo_leer on public.conta_proveedor_solo for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.conta_proveedor_solo from anon, authenticated;
grant select on table public.conta_proveedor_solo to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_proveedor_solo, public.conta_gasto_por_venta to conta_lectura;
  end if;
end $$;

-- 5 · El alta sola ---------------------------------------------------------------------------------
create or replace function public._r14_partir_direccion(p text)
returns jsonb language sql immutable as $function$
  -- «C/ Ejemplo 1, 28000 Madrid» → calle «C/ Ejemplo 1», cp «28000», ciudad «Madrid». Sin cp, todo a la calle.
  select case
    when m is null then jsonb_build_object('calle', nullif(btrim(coalesce(p, ''), ' ,.-'), ''))
    else jsonb_build_object('calle', nullif(btrim(m[1], ' ,.-'), ''), 'cp', m[2], 'ciudad', nullif(btrim(split_part(split_part(btrim(m[3], ' ,.-'), ',', 1), '(', 1), ' ,.-'), ''))
  end
  from (select regexp_match(coalesce(p, ''), '^(.*?)[\s,.-]*\m([0-5][0-9]{4})\M(.*)$') as m) x
$function$;

create or replace function public._conta_proveedor_solo(p_invoice uuid, p_cuando text default 'al_leer')
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v public.supplier_invoice; c public.company; p jsonb; v_nif text; v_nombre text; v_tipo text; v_pais text;
  v_party uuid; v_s uuid; v_que text; v_creado boolean := false; v_k uuid; v_kcreada boolean := false;
  v_plan text; v_d int; v_hoja text; v_code text; v_gasto jsonb; v_dir jsonb; v_origen jsonb; v_motivo text; v_txt text;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null then return jsonb_build_object('que', 'no', 'motivo', 'No está.'); end if;
  if v.supplier_id is not null then return jsonb_build_object('que', 'ya', 'supplier_id', v.supplier_id); end if;
  if exists (select 1 from public.conta_proveedor_solo x where x.invoice_id = p_invoice and (x.deshecho_at is not null or x.que <> 'no')) then
    return jsonb_build_object('que', 'ya', 'motivo', 'Ya se miró (o se deshizo).');
  end if;
  -- Lo validado no se toca; lo descartado o anulado, tampoco.
  if v.status in ('descartada', 'anulada', 'pagada') or exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = p_invoice and e.status = 'validado') then
    return jsonb_build_object('que', 'ya', 'motivo', 'Validada, pagada, descartada o anulada: no se toca.');
  end if;
  p := v.reading->'factura'->'proveedor';
  if p is null then return jsonb_build_object('que', 'ya', 'motivo', 'Sin lectura del proveedor.'); end if;
  select * into c from public.company where id = v.company_id;
  v_nif := public._conta_nif_clave(p->>'nif');
  v_nombre := nullif(btrim(regexp_replace(coalesce(p->>'nombre', ''), '\s+', ' ', 'g')), '');

  if v_nif is null then
    v_motivo := 'La factura no trae el NIF del proveedor: dalo de alta tú.';
  elsif v_nif = public._conta_nif_clave(c.tax_id) then
    v_motivo := format('El NIF del proveedor (%s) es el de %s: parece una factura emitida, no recibida.', v_nif, coalesce(c.legal_name, 'la propia empresa'));
  end if;

  if v_motivo is null then
    -- Una plataforma de la cuenta: su tercero (con o sin ficha de proveedor).
    select pt.id into v_party from public.party pt
     where pt.account_id = v.account_id and public._conta_nif_clave(pt.tax_id) = v_nif
       and exists (select 1 from public.party_role r where r.party_id = pt.id and r.role = 'platform') limit 1;
    if v_party is not null then
      v_que := 'plataforma';
      select supplier_id into v_s from public.party_role where party_id = v_party and role = 'supplier';
    else
      -- Un proveedor de la cuenta, de esta u otra sociedad: el mismo tercero.
      select s.id into v_s from public.supplier s
       where s.account_id = v.account_id and s.archived_at is null and public._conta_nif_clave(s.tax_id) = v_nif
       order by s.created_at limit 1;
      v_que := case when v_s is null then 'alta' else 'existente' end;
    end if;
    if v_s is null then
      v_tipo := case when public._verifactu_nif_es_valido(v_nif) then 'nif_es'
                     when v_nif ~ '^[A-Z]{2}' and public._verifactu_nif_iva_ue_valido(left(v_nif, 2), substr(v_nif, 3)) then 'vat_eu' end;
      if v_tipo is null and v_que <> 'plataforma' then
        v_motivo := format('El NIF leído (%s) no es válido: compruébalo en el papel y dalo de alta tú.', v_nif);
      elsif v_nombre is null then
        v_motivo := 'No leí el nombre del proveedor: dalo de alta tú.';
      end if;
    end if;
  end if;

  if v_motivo is not null then
    insert into public.conta_proveedor_solo (invoice_id, account_id, company_id, que, motivo, nif, cuando)
    values (p_invoice, v.account_id, v.company_id, 'no', v_motivo, v_nif, p_cuando)
    on conflict (invoice_id) do update set que = 'no', motivo = excluded.motivo, nif = excluded.nif, company_id = excluded.company_id;
    return jsonb_build_object('que', 'no', 'motivo', v_motivo);
  end if;

  -- El proveedor nuevo, con lo que trae la factura.
  if v_s is null then
    v_pais := case when v_tipo = 'vat_eu' then left(v_nif, 2) else 'ES' end;
    v_dir := public._r14_partir_direccion(p->>'direccion');
    v_origen := jsonb_build_object('factura', v.invoice_number, 'facturaId', v.id, 'fecha', to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD'), 'quien', 'Sumied');
    insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, country_code, entity_kind,
                                 tax_id_check_status, tax_id_checked_at, tax_id_verified_at,
                                 fiscal_street, fiscal_postal_code, fiscal_city, email, phone, website,
                                 is_active, created_from, created_by_name, data_from_invoice)
    values (v.account_id, coalesce(v_nombre, v_nif), v_nombre, v_nif, coalesce(v_tipo, 'foreign'), v_pais,
            case when v_tipo = 'nif_es' and (v_nif ~ '^\d{8}[A-Z]$' or v_nif ~ '^[XYZKLM]') then 'self_employed'
                 when v_tipo = 'nif_es' and v_nif ~ '^[ABCDEFGHJNPQRSUVW]' then 'company' end,
            case when v_tipo = 'nif_es' then 'valid' end, case when v_tipo = 'nif_es' then now() end, case when v_tipo = 'nif_es' then now() end,
            v_dir->>'calle', v_dir->>'cp', v_dir->>'ciudad',
            nullif(btrim(p->>'email'), ''), nullif(btrim(p->>'telefono'), ''), nullif(btrim(p->>'web'), ''),
            true, 'factura', 'Sumied',
            (select jsonb_object_agg(k, v_origen) from unnest(array['nif', 'nombreFiscal']
               || case when v_dir->>'calle' is not null or v_dir->>'cp' is not null then array['direccion'] else '{}' end
               || case when nullif(btrim(p->>'email'), '') is not null then array['correo'] else '{}' end
               || case when nullif(btrim(p->>'telefono'), '') is not null then array['telefono'] else '{}' end
               || case when nullif(btrim(p->>'web'), '') is not null then array['web'] else '{}' end) k))
    returning id into v_s;
    v_creado := true;
  end if;

  -- Su subcuenta en esta empresa: la siguiente libre de la 4000 o de la 4100 (la plataforma, su 410).
  select k.company_account_id into v_k from public.company_account_link k
   where k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = v_s::text and k.role = 'principal';
  select a.plan, length(a.code) into v_plan, v_d from public.company_account a where a.company_id = v.company_id limit 1;
  if v_k is null and v_plan is not null then
    if v_que = 'plataforma' then v_hoja := '4100';
    else
      v_gasto := public._conta_gasto_propuesto(v.company_id, v_s, p_invoice);
      v_hoja := case when v_gasto->>'cuenta' like '60%' then '4000' else '4100' end;
    end if;
    v_code := public.company_account_siguiente(v.company_id, v_hoja, v_d);
    if v_code is not null then
      select name into v_txt from public.supplier where id = v_s;
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
      values (v.account_id, v.company_id, v_plan, v_code, v_hoja, (case v_hoja when '4000' then 'Proveedores · ' else 'Acreedores · ' end) || v_txt, 'own', 'manual', 'Sumied')
      returning id into v_k;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
      values (v.account_id, v.company_id, v_k, 'supplier', v_s::text, 'principal', 'manual');
      insert into public.company_account_log (account_id, company_id, que, code, detalle, despues, source, done_by_name)
      values (v.account_id, v.company_id, 'subcuenta_creada', v_code, format('Subcuenta %s · %s, bajo la %s (la dio de alta Sumied con la factura %s).', v_code, v_txt, v_hoja, coalesce(v.invoice_number, 'sin número')),
              jsonb_build_object('code', v_code, 'entity', 'supplier', 'entity_id', v_s, 'r14', true), 'manual', 'Sumied');
      v_kcreada := true;
    end if;
  end if;

  update public.supplier_invoice set supplier_id = v_s where id = p_invoice;
  insert into public.conta_proveedor_solo (invoice_id, account_id, company_id, que, supplier_id, supplier_creado, cuenta_id, cuenta_creada, nif, cuando)
  values (p_invoice, v.account_id, v.company_id, v_que, v_s, v_creado, v_k, v_kcreada, v_nif, p_cuando)
  on conflict (invoice_id) do update set que = excluded.que, supplier_id = excluded.supplier_id, supplier_creado = excluded.supplier_creado,
    cuenta_id = excluded.cuenta_id, cuenta_creada = excluded.cuenta_creada, motivo = null, nif = excluded.nif, company_id = excluded.company_id;
  select name into v_txt from public.supplier where id = v_s;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text)
  values (v.account_id, v.company_id, v.inbox_id, p_invoice, 'folvy', 'Sumied', 'corregida',
          case v_que when 'alta' then format('Proveedor nuevo: Sumied ha dado de alta a %s con lo que trae la factura%s.', v_txt, coalesce(', con su subcuenta ' || v_code, ''))
                     when 'plataforma' then format('Es la plataforma %s: la factura va a su ficha%s.', v_txt, coalesce(' y a su ' || v_code, ''))
                     else format('Es %s, que ya estaba dado de alta en la cuenta%s.', v_txt, coalesce(': su subcuenta en esta empresa, ' || v_code, '')) end);
  return jsonb_build_object('que', v_que, 'supplier_id', v_s, 'creado', v_creado, 'subcuenta', v_code);
end $function$;
comment on function public._conta_proveedor_solo(uuid, text) is 'R14: el proveedor de una recibida leída sin proveedor. Lo encuentra (plataforma o proveedor de la cuenta) o lo da de alta con lo leído y su subcuenta (siguiente libre de la 4000/4100); o apunta por qué no (sin NIF, NIF no válido, el de la propia empresa). Lo validado no se toca. Lo apunta en conta_proveedor_solo.';
revoke all on function public._conta_proveedor_solo(uuid, text) from public, anon, authenticated;

-- 6 · Deshacer ------------------------------------------------------------------------------------
create or replace function public._conta_proveedor_solo_deshacer(p_invoice uuid, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare r public.conta_proveedor_solo; v public.supplier_invoice; v_nombre text; v_quien text; v_sigue boolean := false; v_texto text;
begin
  select * into r from public.conta_proveedor_solo where invoice_id = p_invoice for update;
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if r.invoice_id is null or r.que = 'no' or r.deshecho_at is not null then
    raise exception 'Sumied no le ha puesto proveedor a esta factura: no hay nada que deshacer.' using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = p_invoice and e.status = 'validado') then
    raise exception 'La factura ya está validada: anula antes su asiento.' using errcode = '22023';
  end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  select name into v_nombre from public.supplier where id = r.supplier_id;
  update public.supplier_invoice set supplier_id = null where id = p_invoice and supplier_id = r.supplier_id;
  if r.supplier_creado then
    v_sigue := exists (select 1 from public.supplier_invoice i where i.supplier_id = r.supplier_id and i.id <> p_invoice)
            or exists (select 1 from public.journal_line l join public.company_account_link k on k.company_account_id = l.company_account_id
                        where k.entity = 'supplier' and k.entity_id = r.supplier_id::text);
  end if;
  if r.cuenta_creada and r.cuenta_id is not null and not v_sigue
     and not exists (select 1 from public.journal_line l where l.company_account_id = r.cuenta_id) then
    delete from public.company_account_link where company_account_id = r.cuenta_id;
    delete from public.company_account where id = r.cuenta_id;
  end if;
  if r.supplier_creado and not v_sigue then
    delete from public.party p where p.id = (select party_id from public.party_role where supplier_id = r.supplier_id and role = 'supplier')
       and p.source = 'supplier' and (select count(*) from public.party_role x where x.party_id = p.id) = 1;
    delete from public.supplier where id = r.supplier_id;
    v_texto := format('Deshecho: %s ya no está dado de alta y la factura vuelve a no tener proveedor.', coalesce(v_nombre, 'el proveedor'));
  else
    v_texto := format('Deshecho: la factura ya no es de %s y vuelve a no tener proveedor.', coalesce(v_nombre, 'ese proveedor'));
  end if;
  update public.conta_proveedor_solo set deshecho_at = now(), deshecho_por = v_quien where invoice_id = p_invoice;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text)
  values (v.account_id, v.company_id, v.inbox_id, p_invoice, 'persona', v_quien, 'corregida', v_quien || ' ha deshecho lo de Sumied. ' || v_texto);
  return jsonb_build_object('texto', v_texto);
end $function$;
comment on function public._conta_proveedor_solo_deshacer(uuid, text) is 'R14: lo de conta_proveedor_solo_deshacer, sin mirar quién llama (lo usa la vuelta atrás de la 1130).';
revoke all on function public._conta_proveedor_solo_deshacer(uuid, text) from public, anon, authenticated;

create or replace function public.conta_proveedor_solo_deshacer(p_invoice uuid, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v_acc uuid;
begin
  select account_id into v_acc from public.supplier_invoice where id = p_invoice;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  return public._conta_proveedor_solo_deshacer(p_invoice, p_quien_nombre);
end $function$;
comment on function public.conta_proveedor_solo_deshacer(uuid, text) is 'R14: «Deshacer» el proveedor que Sumied le puso a una recibida. La factura vuelve a no tener proveedor; si Sumied lo dio de alta y no tiene nada más, se borra con su subcuenta (sin apuntes). No con la factura validada.';
revoke all on function public.conta_proveedor_solo_deshacer(uuid, text) from public, anon;
grant execute on function public.conta_proveedor_solo_deshacer(uuid, text) to authenticated, service_role;
