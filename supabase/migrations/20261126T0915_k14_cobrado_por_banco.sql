-- supabase/migrations/20261126T0915_k14_cobrado_por_banco.sql
--
-- K14 · Lo cobrado por el banco, casado solo con su cliente (26/11). QBO cobra también por transferencia, Bizum y
-- tarjeta, y desde noviembre solo se factura lo cobrado y confirmado, por la vía que sea (regla de Julio). Esta tanda
-- deja la tabla de lo casado, que leen Q (Facturas del mes) y R («Te deben», R20):
--
--   · conta_banco_cobro: una fila por entrada del banco que no es de GoCardless. De qué cliente es (party_id), por qué,
--     su estado (casado, por_confirmar, sin_cliente, tarjeta o no_es_cobro), lo que es recargo de devolución (2 € por
--     recibo) y lo que queda como cobro del cliente del mes (cobro), con el mes de la factura (mes). La escribe el motor
--     (_shared/cobro/porBanco.ts), que se pasa al leer un extracto; lo que decide una persona («Sí, es este», «Es
--     otro…», «No es de ningún cliente») queda en decidido_* y el motor lo respeta.
--   · conta_banco_cobro_recibo: los recibos de GoCardless sin cobrar (fallidos o devueltos) que paga cada entrada. Un
--     recibo, una sola entrada (clave company_id, gc_id). Esos quedan «pagados por el banco».
--
-- Funciones: conta_banco_cobros_datos (lo que lee el motor), conta_banco_cobros_guardar (lo que escribe) y
-- conta_banco_cobro_decidir (lo que decide una persona). Solo un administrador de la cuenta.
--
-- Solo añade (dos tablas y tres funciones nuevas). Nada en el camino del pedido. No toca conta_gc_cobro_otra_via (el
-- «Cobrado por otra vía» a mano del G04, de «Te deben»): lo lee, para no volver a pagar un recibo ya marcado.

create table if not exists public.conta_banco_cobro (
  movement_id      uuid primary key references public.bank_movement(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  fecha            date not null,
  importe          numeric(14,2) not null check (importe > 0),
  via              text not null check (via in ('transferencia', 'traspaso', 'bizum', 'cajero', 'tarjeta', 'otra')),
  estado           text not null check (estado in ('casado', 'por_confirmar', 'sin_cliente', 'tarjeta', 'no_es_cobro')),
  party_id         uuid references public.party(id) on delete set null,
  porque           text not null,
  recargo          numeric(14,2) not null default 0 check (recargo >= 0),
  cobro            numeric(14,2) not null default 0 check (cobro >= 0),
  mes              date not null,
  decidido_party   uuid references public.party(id) on delete set null,
  decidido_ninguno boolean not null default false,
  decidido_por     uuid,
  decidido_nombre  text,
  decidido_en      timestamptz,
  motor            text not null,
  calculado_en     timestamptz not null default now(),
  check (estado <> 'casado' or party_id is not null),
  check (mes = date_trunc('month', mes)::date)
);
comment on table public.conta_banco_cobro is
  'K14 · Lo cobrado por el banco que no es de GoCardless, casado con su cliente: una fila por entrada. Q lee las casadas (estado = casado): cobro es lo del mes del cliente para facturar, recargo el de devolución; sus recibos pagados, en conta_banco_cobro_recibo. La escribe el motor (conta_banco_cobros_guardar); lo que decide una persona, conta_banco_cobro_decidir.';
comment on column public.conta_banco_cobro.cobro is 'K14 · Lo que queda como cobro del cliente del mes (importe menos los recibos que paga y su recargo). Para facturar.';
comment on column public.conta_banco_cobro.recargo is 'K14 · El recargo de devolución (2 € por recibo pagado: 1,65 € más IVA, concepto 0018 de Cegid).';
comment on column public.conta_banco_cobro.mes is 'K14 · El mes de la factura: el de la entrada.';
comment on column public.conta_banco_cobro.party_id is 'K14 · El cliente (casado) o el propuesto (por confirmar).';
create index if not exists conta_banco_cobro_empresa_idx on public.conta_banco_cobro (company_id, mes, estado);

create table if not exists public.conta_banco_cobro_recibo (
  company_id  uuid not null references public.company(id) on delete cascade,
  gc_id       text not null,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  movement_id uuid not null references public.conta_banco_cobro(movement_id) on delete cascade,
  importe     numeric(14,2) not null check (importe > 0),
  primary key (company_id, gc_id)
);
comment on table public.conta_banco_cobro_recibo is
  'K14 · Los recibos de GoCardless sin cobrar (fallidos o devueltos) pagados por el banco: cada uno, por una sola entrada (movement_id). R y Q los leen para no contarlos como deuda.';
create index if not exists conta_banco_cobro_recibo_mov_idx on public.conta_banco_cobro_recibo (movement_id);

alter table public.conta_banco_cobro enable row level security;
alter table public.conta_banco_cobro_recibo enable row level security;
drop policy if exists conta_banco_cobro_leer on public.conta_banco_cobro;
create policy conta_banco_cobro_leer on public.conta_banco_cobro for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_banco_cobro_recibo_leer on public.conta_banco_cobro_recibo;
create policy conta_banco_cobro_recibo_leer on public.conta_banco_cobro_recibo for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_banco_cobro, public.conta_banco_cobro_recibo from anon;
grant select on public.conta_banco_cobro, public.conta_banco_cobro_recibo to authenticated;
grant all on public.conta_banco_cobro, public.conta_banco_cobro_recibo to service_role;

-- La empresa, si es de quien llama y es administrador de su cuenta.
create or replace function public._conta_banco_cobro_empresa(p_company uuid)
returns public.company language plpgsql stable security definer set search_path = public as $$
declare v_c public.company;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta casa los cobros del banco.' using errcode = '42501';
  end if;
  return v_c;
end $$;
revoke all on function public._conta_banco_cobro_empresa(uuid) from public, anon;
grant execute on function public._conta_banco_cobro_empresa(uuid) to authenticated, service_role;

-- Lo que lee el motor (solo en las empresas con clientes de GoCardless; en las demás, {aplica: false}): las entradas del banco de la empresa, sus clientes (ficha, NIF y nombres en GoCardless), los
-- recibos de GoCardless sin cobrar y lo que ya decidió una persona. Regla 9: todo de esta empresa y su cuenta.
create or replace function public.conta_banco_cobros_datos(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c public.company;
begin
  v_c := public._conta_banco_cobro_empresa(p_company);
  -- Solo las empresas que cobran a clientes por GoCardless (QBO): en las demás no hay nada que casar aquí.
  if not exists (select 1 from public.conta_gc_cliente k where k.company_id = v_c.id) then
    return jsonb_build_object('aplica', false);
  end if;
  return jsonb_build_object(
    'aplica', true,
    'entradas', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'fecha', m.op_date, 'importe', m.amount, 'concepto', m.bank_concept) order by m.op_date, m.id)
        from public.bank_movement m
       where m.account_id = v_c.account_id and m.company_id = v_c.id and m.amount > 0), '[]'::jsonb),
    'clientes', coalesce((
      with c as (
        select g.party_id from public.conta_gestoria_cliente g where g.account_id = v_c.account_id and g.emisor_segun_crm = v_c.id
        union select k.party_id from public.conta_cobro_cliente k where k.company_id = v_c.id
        union select k.party_id from public.conta_gc_cliente k where k.company_id = v_c.id and k.party_id is not null)
      select jsonb_agg(jsonb_build_object('party_id', p.id, 'nombre', p.name, 'nif', p.tax_id,
               'nombres_gc', coalesce((select jsonb_agg(distinct k.nombre) from public.conta_gc_cliente k
                                        where k.company_id = v_c.id and k.party_id = p.id and k.nombre is not null), '[]'::jsonb)) order by p.id)
        from public.party p join c on c.party_id = p.id
       where p.account_id = v_c.account_id), '[]'::jsonb),
    'recibos', coalesce((
      select jsonb_agg(jsonb_build_object('gc_id', g.gc_id, 'party_id', k.party_id, 'fecha', g.fecha, 'importe', g.importe) order by g.fecha, g.gc_id)
        from public.conta_gc_cobro g
        join public.conta_gc_mandato md on md.company_id = g.company_id and md.gc_id = g.mandato_gc_id
        join public.conta_gc_cliente k on k.company_id = g.company_id and k.gc_id = md.gc_cliente_id
       where g.company_id = v_c.id and g.estado in ('failed', 'charged_back') and g.importe > 0 and k.party_id is not null
         and not exists (select 1 from public.conta_gc_cobro_otra_via o where o.company_id = g.company_id and o.gc_id = g.gc_id)), '[]'::jsonb),
    'decisiones', coalesce((
      select jsonb_agg(jsonb_build_object('movement_id', b.movement_id, 'party_id', b.decidido_party, 'ninguno', b.decidido_ninguno))
        from public.conta_banco_cobro b where b.company_id = v_c.id and b.decidido_en is not null), '[]'::jsonb));
end $$;
revoke all on function public.conta_banco_cobros_datos(uuid) from public, anon;
grant execute on function public.conta_banco_cobros_datos(uuid) to authenticated, service_role;

-- Lo que escribe el motor: cada fila con sus recibos. Lo decidido por una persona no se toca. Un recibo que ya paga otra
-- entrada para la escritura entera (regla 8: se dice, no se salta). Devuelve las cuentas.
create or replace function public.conta_banco_cobros_guardar(p_company uuid, p_filas jsonb, p_motor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c public.company;
  f jsonb; r jsonb;
  v_mov uuid; v_n int := 0;
begin
  v_c := public._conta_banco_cobro_empresa(p_company);
  if jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Faltan las filas.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_motor, '')), '') is null then raise exception 'Falta qué motor las calcula.' using errcode = '22023'; end if;
  -- Todas las entradas son de esta empresa.
  if exists (select 1 from jsonb_array_elements(p_filas) x
              where not exists (select 1 from public.bank_movement m where m.id = (x->>'movement_id')::uuid and m.company_id = v_c.id and m.account_id = v_c.account_id)) then
    raise exception 'Alguna entrada no es de esta empresa.' using errcode = '22023';
  end if;
  delete from public.conta_banco_cobro_recibo b
   where b.company_id = v_c.id and b.movement_id in (select (x->>'movement_id')::uuid from jsonb_array_elements(p_filas) x);
  for f in select * from jsonb_array_elements(p_filas) loop
    v_mov := (f->>'movement_id')::uuid;
    insert into public.conta_banco_cobro as b (movement_id, account_id, company_id, fecha, importe, via, estado, party_id, porque, recargo, cobro, mes, motor, calculado_en)
    values (v_mov, v_c.account_id, v_c.id, (f->>'fecha')::date, (f->>'importe')::numeric, f->>'via', f->>'estado', nullif(f->>'party_id', '')::uuid,
            f->>'porque', coalesce((f->>'recargo')::numeric, 0), coalesce((f->>'cobro')::numeric, 0), date_trunc('month', (f->>'fecha')::date)::date, p_motor, now())
    on conflict (movement_id) do update set
      fecha = excluded.fecha, importe = excluded.importe, via = excluded.via, estado = excluded.estado, party_id = excluded.party_id,
      porque = excluded.porque, recargo = excluded.recargo, cobro = excluded.cobro, mes = excluded.mes, motor = excluded.motor, calculado_en = now();
    for r in select * from jsonb_array_elements(coalesce(f->'recibos', '[]'::jsonb)) loop
      if exists (select 1 from public.conta_banco_cobro_recibo b where b.company_id = v_c.id and b.gc_id = r->>'gc_id') then
        raise exception 'El recibo % ya lo paga otra entrada del banco.', r->>'gc_id' using errcode = '23505';
      end if;
      insert into public.conta_banco_cobro_recibo (company_id, gc_id, account_id, movement_id, importe)
      values (v_c.id, r->>'gc_id', v_c.account_id, v_mov, (r->>'importe')::numeric);
    end loop;
    v_n := v_n + 1;
  end loop;
  return (select jsonb_build_object('guardadas', v_n,
    'casados', count(*) filter (where estado = 'casado'), 'casados_importe', coalesce(sum(importe) filter (where estado = 'casado'), 0),
    'por_confirmar', count(*) filter (where estado in ('por_confirmar', 'sin_cliente')), 'por_confirmar_importe', coalesce(sum(importe) filter (where estado in ('por_confirmar', 'sin_cliente')), 0),
    'tarjeta', count(*) filter (where estado = 'tarjeta'), 'tarjeta_importe', coalesce(sum(importe) filter (where estado = 'tarjeta'), 0),
    'recibos', (select count(*) from public.conta_banco_cobro_recibo x where x.company_id = v_c.id))
    from public.conta_banco_cobro where company_id = v_c.id);
end $$;
revoke all on function public.conta_banco_cobros_guardar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_banco_cobros_guardar(uuid, jsonb, text) to authenticated, service_role;

-- Lo que decide una persona: «Sí, es este» / «Es otro…» (p_party), «No es de ningún cliente» (p_ninguno) o deshacer
-- (los dos vacíos). El motor lo respeta en su siguiente pasada (la pantalla la lanza enseguida). Devuelve la frase.
create or replace function public.conta_banco_cobro_decidir(p_movement uuid, p_party uuid, p_ninguno boolean, p_quien_nombre text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_b public.conta_banco_cobro; v_c public.company; v_nombre text; v_quien text;
begin
  select * into v_b from public.conta_banco_cobro where movement_id = p_movement;
  if v_b.movement_id is null then raise exception 'Esa entrada del banco no está casada todavía.' using errcode = 'P0002'; end if;
  v_c := public._conta_banco_cobro_empresa(v_b.company_id);
  if p_party is not null and coalesce(p_ninguno, false) then raise exception 'O un cliente, o ninguno.' using errcode = '22023'; end if;
  if p_party is not null then
    select p.name into v_nombre from public.party p where p.id = p_party and p.account_id = v_c.account_id;
    if v_nombre is null then raise exception 'Ese cliente no está en esta cuenta.' using errcode = 'P0002'; end if;
  end if;
  v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  if p_party is null and not coalesce(p_ninguno, false) then
    update public.conta_banco_cobro set decidido_party = null, decidido_ninguno = false, decidido_por = null, decidido_nombre = null, decidido_en = null
     where movement_id = p_movement;
    return 'Deshecho: Sumied vuelve a casar esta entrada solo.';
  end if;
  update public.conta_banco_cobro set decidido_party = p_party, decidido_ninguno = coalesce(p_ninguno, false),
         decidido_por = auth.uid(), decidido_nombre = v_quien, decidido_en = now()
   where movement_id = p_movement;
  return case when p_party is not null then format('Apuntado: la entrada del %s de %s € es de %s.', to_char(v_b.fecha, 'DD/MM'), translate(to_char(v_b.importe, 'FM999G999G990D00'), ',.', '.,'), v_nombre)
              else format('Apuntado: la entrada del %s de %s € no es de ningún cliente.', to_char(v_b.fecha, 'DD/MM'), translate(to_char(v_b.importe, 'FM999G999G990D00'), ',.', '.,')) end;
end $$;
revoke all on function public.conta_banco_cobro_decidir(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.conta_banco_cobro_decidir(uuid, uuid, boolean, text) to authenticated, service_role;
