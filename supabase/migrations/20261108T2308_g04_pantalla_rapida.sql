-- supabase/migrations/20261108T2308_g04_pantalla_rapida.sql
--
-- G04 · La pantalla de Clientes entera en menos de 1 s (Julio, nº 20, 08/11:
-- regla nueva para todas las pantallas). SOLO AÑADE: cuatro funciones nuevas.
--
-- Por qué: con la 2209 la lista ya va en 62–75 ms por página, pero la misma
-- pantalla lee a la vez otras cuatro tablas con la RLS fila a fila
-- (belongs_to_account, 0,24 ms por fila leída). Medido en producción el 08/11
-- como authenticated con el administrador de QBO, por páginas de 1.000 como
-- las pide el front (cada página vuelve a pasar la RLS por toda la tabla):
--   · conta_gc_cobro (2.855): 3 páginas de ~690 ms, unos 2,1 s seguidos.
--   · conta_gc_mandato (2.099): 3 páginas de ~500 ms, unos 1,5 s.
--   · conta_gestoria_cliente (1.535, solo la ficha): 2 páginas de ~385 ms.
--   · conta_gc_suscripcion (412 activas de 2.636): ~100 ms.
-- Las demás lecturas de la pantalla van por debajo de 200 ms.
--
-- Arreglo, como la 2209: funciones SECURITY DEFINER que comprueban UNA vez
-- que quien llama es de la cuenta (belongs_to_account) y leen la tabla
-- filtrando por esa cuenta. Si no es de la cuenta, ninguna fila: lo mismo que
-- la RLS. Devuelven solo las columnas que lee la pantalla, las mismas filas
-- que la tabla con la RLS.
--   · conta_lista_gc_cobros(p_cuenta)        ⇔ conta_gc_cobro
--   · conta_lista_gc_mandatos(p_cuenta)      ⇔ conta_gc_mandato
--   · conta_lista_gc_suscripciones(p_cuenta) ⇔ conta_gc_suscripcion, las activas
--   · conta_lista_fichas(p_cuenta)           ⇔ conta_gestoria_cliente (ficha y leido_at)
-- Las tablas y su RLS no se tocan; la versión publicada del front las sigue
-- leyendo.
--
-- No toca datos. No lee ni escribe en GoCardless ni en el CRM. Nada en el
-- camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261108T2308_g04_pantalla_rapida.down.sql

create or replace function public.conta_lista_gc_cobros(p_cuenta uuid)
returns table (company_id uuid, gc_id text, mandato_gc_id text, suscripcion_gc_id text, estado text, fecha date, importe numeric, motivo text)
language sql stable security definer set search_path = public as $$
  -- La única comprobación: si quien llama no es de la cuenta, ninguna fila.
  select b.company_id, b.gc_id, b.mandato_gc_id, b.suscripcion_gc_id, b.estado, b.fecha, b.importe, b.motivo
    from public.conta_gc_cobro b
   where b.account_id = p_cuenta and public.belongs_to_account(p_cuenta)
$$;

create or replace function public.conta_lista_gc_mandatos(p_cuenta uuid)
returns table (company_id uuid, gc_id text, gc_cliente_id text, estado text, creado timestamptz)
language sql stable security definer set search_path = public as $$
  select m.company_id, m.gc_id, m.gc_cliente_id, m.estado, m.creado
    from public.conta_gc_mandato m
   where m.account_id = p_cuenta and public.belongs_to_account(p_cuenta)
$$;

create or replace function public.conta_lista_gc_suscripciones(p_cuenta uuid)
returns table (company_id uuid, gc_id text, gc_cliente_id text, nombre text, importe numeric, al_mes numeric, estado text, inicio date, fin date,
               proximo_cobro_fecha date, proximo_cobro_importe numeric)
language sql stable security definer set search_path = public as $$
  select s.company_id, s.gc_id, s.gc_cliente_id, s.nombre, s.importe, s.al_mes, s.estado, s.inicio, s.fin, s.proximo_cobro_fecha, s.proximo_cobro_importe
    from public.conta_gc_suscripcion s
   where s.account_id = p_cuenta and s.estado = 'active' and public.belongs_to_account(p_cuenta)
$$;

create or replace function public.conta_lista_fichas(p_cuenta uuid)
returns table (party_id uuid, ficha jsonb, leido_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.party_id, c.ficha, c.leido_at
    from public.conta_gestoria_cliente c
   where c.account_id = p_cuenta and public.belongs_to_account(p_cuenta)
$$;

revoke all on function public.conta_lista_gc_cobros(uuid) from public, anon;
revoke all on function public.conta_lista_gc_mandatos(uuid) from public, anon;
revoke all on function public.conta_lista_gc_suscripciones(uuid) from public, anon;
revoke all on function public.conta_lista_fichas(uuid) from public, anon;
grant execute on function public.conta_lista_gc_cobros(uuid) to authenticated, service_role;
grant execute on function public.conta_lista_gc_mandatos(uuid) to authenticated, service_role;
grant execute on function public.conta_lista_gc_suscripciones(uuid) to authenticated, service_role;
grant execute on function public.conta_lista_fichas(uuid) to authenticated, service_role;

comment on function public.conta_lista_gc_cobros(uuid) is
  'G04 · Los cobros de GoCardless de la cuenta para la pantalla de Clientes: las filas de conta_gc_cobro que da la RLS, con una sola comprobación de la cuenta (con la RLS fila a fila, 2,1 s en QBO).';
comment on function public.conta_lista_gc_mandatos(uuid) is
  'G04 · Los mandatos de GoCardless de la cuenta para la pantalla de Clientes, con una sola comprobación de la cuenta (con la RLS, 1,5 s en QBO).';
comment on function public.conta_lista_gc_suscripciones(uuid) is
  'G04 · Las suscripciones activas de GoCardless de la cuenta para la pantalla de Clientes, con una sola comprobación de la cuenta.';
comment on function public.conta_lista_fichas(uuid) is
  'G04 · La ficha leída del CRM de cada cliente de la cuenta (party_id, ficha, leido_at) para la pantalla de Clientes, con una sola comprobación de la cuenta (con la RLS, 0,8 s en QBO).';
