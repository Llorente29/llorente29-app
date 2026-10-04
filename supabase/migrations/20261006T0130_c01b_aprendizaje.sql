-- supabase/migrations/20261006T0130_c01b_aprendizaje.sql
--
-- C01b, tarea 5 · «Lo que he aprendido de este proveedor» y su registro en
-- «Lo que ha hecho Folvy». Y la decisión «no es repetida» de una factura.
--
-- SOLO AÑADE: dos tablas nuevas, tres columnas nuevas (nulas) en
-- supplier_invoice y tres funciones nuevas. No cambia ni borra nada que exista.
--
--   supplier_learning      Lo aprendido HOY, una fila por proveedor y dato
--                          (tipo de gasto, IVA, retención, forma de pago, IBAN),
--                          con su porqué, desde cuándo y si alguien lo fijó a
--                          mano con «Cambiar» (lo fijado a mano gana).
--   supplier_learning_log  «Lo que ha hecho Folvy» de proveedores: cada vez
--                          que aprende, olvida o alguien cambia lo aprendido.
--                          Como el registro del R02 (r02_folvy_respuesta), es
--                          tabla propia: ai_action_log es por EMPRESA y una
--                          cuenta sin contabilidad (la B) no tiene empresa.
--
-- Las REGLAS de aprender están en el núcleo (src/modules/conta/lib/
-- aprendizaje.ts, probadas): la base guarda lo que el núcleo decide, en una
-- sola transacción (supplier_learning_sync), y NUNCA contabiliza nada: lo
-- aprendido solo se PROPONE en la factura siguiente, siempre por confirmar.
--
-- Seguridad: las funciones son SECURITY INVOKER, así que pasan por la RLS de
-- cada tabla (ver: quien pertenece a la cuenta; escribir: administrador o
-- encargado, como supplier_contact). Ninguna se llama desde un disparador ni
-- un cron: no está en el camino del pedido.

-- ── 1. Lo aprendido ─────────────────────────────────────────────────────
create table public.supplier_learning (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  supplier_id   uuid not null references public.supplier(id) on delete cascade,
  campo         text not null check (campo in ('expense_category', 'tax_rates', 'withholding', 'payment', 'iban')),
  valor         text not null check (length(btrim(valor)) > 0),
  etiqueta      text not null check (length(btrim(etiqueta)) > 0),
  porque        text not null check (length(btrim(porque)) > 0),
  veces         integer not null default 0 check (veces >= 0),
  desde         timestamptz,
  hasta         timestamptz,
  a_mano        boolean not null default false,
  fijado_por    uuid,
  fijado_por_nombre text,
  aprendido_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (supplier_id, campo)
);
create index supplier_learning_account_idx on public.supplier_learning (account_id);
comment on table public.supplier_learning is
  'C01b · Lo que Folvy ha aprendido de cada proveedor (una fila por dato), con su porqué. Se propone en la factura siguiente, nunca se aplica sin confirmación. a_mano = lo fijó una persona con «Cambiar» y gana a lo aprendido.';

alter table public.supplier_learning enable row level security;
create policy supplier_learning_select on public.supplier_learning for select using (public.belongs_to_account(account_id));
create policy supplier_learning_insert on public.supplier_learning for insert with check (public.current_user_is_admin_or_manager_of(account_id));
create policy supplier_learning_update on public.supplier_learning for update using (public.current_user_is_admin_or_manager_of(account_id));
create policy supplier_learning_delete on public.supplier_learning for delete using (public.current_user_is_admin_or_manager_of(account_id));
grant select, insert, update, delete on public.supplier_learning to authenticated;
revoke all on public.supplier_learning from anon;

-- ── 2. Lo que ha hecho Folvy ───────────────────────────────────────────
create table public.supplier_learning_log (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  supplier_id   uuid not null references public.supplier(id) on delete cascade,
  campo         text not null check (campo in ('expense_category', 'tax_rates', 'withholding', 'payment', 'iban')),
  que           text not null check (que in ('aprendido', 'olvidado', 'fijado_a_mano', 'devuelto_a_folvy')),
  valor         text,
  etiqueta      text,
  porque        text not null check (length(btrim(porque)) > 0),
  hecho_at      timestamptz not null default now(),
  hecho_por     uuid,
  hecho_por_nombre text
);
create index supplier_learning_log_supplier_idx on public.supplier_learning_log (supplier_id, hecho_at desc);
create index supplier_learning_log_account_idx on public.supplier_learning_log (account_id);
comment on table public.supplier_learning_log is
  'C01b · «Lo que ha hecho Folvy» con los proveedores: cuándo aprendió u olvidó algo y por qué, y cuándo una persona lo cambió a mano. Solo se añade: no se edita ni se borra.';

alter table public.supplier_learning_log enable row level security;
create policy supplier_learning_log_select on public.supplier_learning_log for select using (public.belongs_to_account(account_id));
create policy supplier_learning_log_insert on public.supplier_learning_log for insert with check (public.current_user_is_admin_or_manager_of(account_id));
grant select, insert on public.supplier_learning_log to authenticated;
revoke all on public.supplier_learning_log from anon;

-- ── 3. «No es repetida» ────────────────────────────────────────────────
-- Una factura con el mismo número e importe que otra se marca «¿Repetida?» y
-- no se apunta hasta que la persona decide. Si dice que NO lo es, queda aquí
-- quién y cuándo, y no se vuelve a marcar.
alter table public.supplier_invoice
  add column not_duplicate_confirmed_at timestamptz,
  add column not_duplicate_confirmed_by uuid,
  add column not_duplicate_confirmed_by_name text;
comment on column public.supplier_invoice.not_duplicate_confirmed_at is
  'C01b · Una persona dijo que esta factura NO es repetida aunque tenga el mismo número e importe que otra del proveedor.';

-- ── 4. Guardar lo que decide el núcleo, en una transacción ─────────────
-- p_items: [{campo, valor, etiqueta, porque, veces, desde, hasta}] = lo que
-- aprender() saca HOY de las facturas. Lo fijado a mano no se toca. Lo que
-- cambia o es nuevo se apunta como «aprendido»; lo que ya no sale, «olvidado».
-- Devuelve cuántas cosas ha apuntado en el registro.
create function public.supplier_learning_sync(p_supplier_id uuid, p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account uuid;
  v_item jsonb;
  v_prev public.supplier_learning;
  v_n integer := 0;
  v_olvidados integer := 0;
  v_campos text[] := '{}';
begin
  select account_id into v_account from public.supplier where id = p_supplier_id;
  if v_account is null then raise exception 'Ese proveedor no existe o no es de tu cuenta.' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'p_items tiene que ser una lista.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_campos := v_campos || (v_item->>'campo');
    select * into v_prev from public.supplier_learning where supplier_id = p_supplier_id and campo = v_item->>'campo';
    if found and v_prev.a_mano then
      continue;
    end if;
    if not found or v_prev.valor is distinct from v_item->>'valor' then
      insert into public.supplier_learning_log (account_id, supplier_id, campo, que, valor, etiqueta, porque)
      values (v_account, p_supplier_id, v_item->>'campo', 'aprendido', v_item->>'valor', v_item->>'etiqueta', v_item->>'porque');
      v_n := v_n + 1;
    end if;
    insert into public.supplier_learning (account_id, supplier_id, campo, valor, etiqueta, porque, veces, desde, hasta)
    values (v_account, p_supplier_id, v_item->>'campo', v_item->>'valor', v_item->>'etiqueta', v_item->>'porque',
            coalesce((v_item->>'veces')::int, 0), (v_item->>'desde')::timestamptz, (v_item->>'hasta')::timestamptz)
    on conflict (supplier_id, campo) do update
      set valor = excluded.valor, etiqueta = excluded.etiqueta, porque = excluded.porque, veces = excluded.veces,
          desde = excluded.desde, hasta = excluded.hasta, updated_at = now(),
          aprendido_at = case when supplier_learning.valor is distinct from excluded.valor then now() else supplier_learning.aprendido_at end;
  end loop;

  -- Lo aprendido que ya no sale (la persona cambió la última vez): se olvida.
  with fuera as (
    delete from public.supplier_learning
     where supplier_id = p_supplier_id and not a_mano and not (campo = any (v_campos))
    returning campo, valor, etiqueta
  )
  insert into public.supplier_learning_log (account_id, supplier_id, campo, que, valor, etiqueta, porque)
  select v_account, p_supplier_id, campo, 'olvidado', valor, etiqueta,
         'Las últimas facturas ya no dicen lo mismo: dejo de proponerlo hasta que se repita tres veces.'
    from fuera;
  get diagnostics v_olvidados = row_count;
  return v_n + v_olvidados;
end $$;
comment on function public.supplier_learning_sync(uuid, jsonb) is
  'C01b · Guarda lo aprendido de un proveedor (lo decide el núcleo) y apunta en supplier_learning_log lo nuevo y lo olvidado. No toca lo fijado a mano.';

-- «Cambiar»: una persona fija el valor (gana a lo aprendido) o, con p_valor
-- nulo, lo devuelve a Folvy (vuelve a aprender de las facturas).
create function public.supplier_learning_fix(
  p_supplier_id uuid, p_campo text, p_valor text, p_etiqueta text, p_quien_nombre text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account uuid;
begin
  select account_id into v_account from public.supplier where id = p_supplier_id;
  if v_account is null then raise exception 'Ese proveedor no existe o no es de tu cuenta.' using errcode = 'P0002'; end if;
  if p_valor is null then
    delete from public.supplier_learning where supplier_id = p_supplier_id and campo = p_campo and a_mano;
    insert into public.supplier_learning_log (account_id, supplier_id, campo, que, porque, hecho_por, hecho_por_nombre)
    values (v_account, p_supplier_id, p_campo, 'devuelto_a_folvy', 'Vuelve a aprenderlo de sus facturas.', auth.uid(), p_quien_nombre);
    return;
  end if;
  insert into public.supplier_learning (account_id, supplier_id, campo, valor, etiqueta, porque, a_mano, fijado_por, fijado_por_nombre)
  values (v_account, p_supplier_id, p_campo, p_valor, p_etiqueta,
          coalesce('Lo fijó ' || nullif(btrim(p_quien_nombre), '') || ' a mano', 'Lo fijaste tú a mano'), true, auth.uid(), p_quien_nombre)
  on conflict (supplier_id, campo) do update
    set valor = excluded.valor, etiqueta = excluded.etiqueta, porque = excluded.porque, a_mano = true,
        fijado_por = excluded.fijado_por, fijado_por_nombre = excluded.fijado_por_nombre, updated_at = now();
  insert into public.supplier_learning_log (account_id, supplier_id, campo, que, valor, etiqueta, porque, hecho_por, hecho_por_nombre)
  values (v_account, p_supplier_id, p_campo, 'fijado_a_mano', p_valor, p_etiqueta, 'Cambiado a mano con «Cambiar».', auth.uid(), p_quien_nombre);
end $$;
comment on function public.supplier_learning_fix(uuid, text, text, text, text) is
  'C01b · «Cambiar» de lo aprendido: fija un valor a mano (gana a lo aprendido) o, con p_valor nulo, lo devuelve a Folvy. Deja rastro en supplier_learning_log.';

-- «No es repetida».
create function public.supplier_invoice_not_duplicate(p_invoice_id uuid, p_quien_nombre text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.supplier_invoice
     set not_duplicate_confirmed_at = now(), not_duplicate_confirmed_by = auth.uid(), not_duplicate_confirmed_by_name = p_quien_nombre
   where id = p_invoice_id;
  if not found then raise exception 'Esa factura no existe o no es de tu cuenta.' using errcode = 'P0002'; end if;
end $$;
comment on function public.supplier_invoice_not_duplicate(uuid, text) is
  'C01b · Una persona dice que esta factura NO es repetida: queda apuntado quién y cuándo, y no se vuelve a marcar.';

revoke all on function public.supplier_learning_sync(uuid, jsonb) from public, anon;
revoke all on function public.supplier_learning_fix(uuid, text, text, text, text) from public, anon;
revoke all on function public.supplier_invoice_not_duplicate(uuid, text) from public, anon;
grant execute on function public.supplier_learning_sync(uuid, jsonb) to authenticated;
grant execute on function public.supplier_learning_fix(uuid, text, text, text, text) to authenticated;
grant execute on function public.supplier_invoice_not_duplicate(uuid, text) to authenticated;
