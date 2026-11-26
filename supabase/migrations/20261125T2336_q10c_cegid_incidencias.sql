-- supabase/migrations/20261125T2336_q10c_cegid_incidencias.sql
--
-- Q10 · respuesta 3 (25/11) · LO MANDADO A CEGID. Sumied manda a la facturación de Cegid (DiezREC), como incidencias
-- del mes, todo lo cobrado y confirmado por GoCardless: una incidencia por cobro. Aquí queda cada una, con el número
-- que le dio Cegid, para:
--   · que nada salga dos veces: un cobro tiene como mucho una incidencia viva (mandando, mandada o facturada);
--   · «Deshacer»: borrar en Cegid las mandadas que aún no estén facturadas (quedan «deshecha», con cuándo y quién);
--   · el punto 5: después de la «Facturación automática», en qué factura acabó cada cobro.
-- SOLO AÑADE una tabla nueva. La escribe solo conta-cegid-mandar (con la clave de servicio); la pantalla la lee con RLS.
-- Vuelta atrás: supabase/vuelta-atras/20261125T2336_q10c_cegid_incidencias.down.sql.

create table if not exists public.conta_cegid_incidencia (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- El cobro de GoCardless (conta_gc_cobro.gc_id) y el mes de la cuota (AAAA-MM).
  gc_cobro_id text not null,
  mes text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- El cliente y el número de incidencia en Cegid (null mientras se manda).
  cliente int not null,
  incidencia int,
  concepto text not null,
  serie text not null,
  texto text not null,
  base numeric not null,
  total numeric not null,
  estado text not null check (estado in ('mandando', 'mandada', 'facturada', 'deshecha', 'fallo')),
  motivo text,
  -- La factura de Cegid en la que acabó (cuando se lea, punto 5).
  ano_factura int,
  serie_factura text,
  numero_factura int,
  mandada_at timestamptz not null default now(),
  mandada_por text,
  deshecha_at timestamptz,
  deshecha_por text
);
comment on table public.conta_cegid_incidencia is
  'Q10 · Cada cobro de GoCardless mandado a la facturación de Cegid como incidencia del mes, con su número en Cegid. Un cobro, como mucho una viva. Solo lo escribe conta-cegid-mandar.';
-- Un cobro, como mucho una incidencia viva: nada sale dos veces.
create unique index if not exists conta_cegid_incidencia_viva_uq on public.conta_cegid_incidencia (company_id, gc_cobro_id)
  where estado in ('mandando', 'mandada', 'facturada');
create index if not exists conta_cegid_incidencia_mes_idx on public.conta_cegid_incidencia (company_id, mes, cliente);

alter table public.conta_cegid_incidencia enable row level security;
drop policy if exists conta_cegid_incidencia_leer on public.conta_cegid_incidencia;
create policy conta_cegid_incidencia_leer on public.conta_cegid_incidencia for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_cegid_incidencia from anon;
grant select on public.conta_cegid_incidencia to authenticated;
grant all on public.conta_cegid_incidencia to service_role;
