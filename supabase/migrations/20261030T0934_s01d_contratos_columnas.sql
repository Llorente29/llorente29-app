-- S01d · Préstamos y aplazamientos (tablero 3): las columnas nuevas del
-- contrato. Solo añade (todas admiten nulos); lo demás, en la 0935.
-- El capital a largo (170/171) y a corto (520/521), el banco donde se carga,
-- el importe, el número de cuotas y el documento que se leyó.

-- ── 1 · Columnas nuevas (todas admiten nulos) ──────────────────────────────
alter table public.recurring_contract
  add column if not exists long_capital_account  text,
  add column if not exists short_capital_account text,
  add column if not exists treasury_account_id   uuid references public.treasury_account(id) on delete set null,
  add column if not exists principal             numeric(14,2) check (principal is null or principal > 0),
  add column if not exists installments          integer check (installments is null or installments > 0),
  add column if not exists document_name         text,
  add column if not exists document_kind         text check (document_kind is null or document_kind in ('excel', 'pdf', 'a_mano'));

comment on column public.recurring_contract.long_capital_account is 'S01d. El capital a más de un año (170/171). Pasarlo a corto al cerrar el año va con el cierre, no aquí.';
comment on column public.recurring_contract.short_capital_account is 'S01d. El capital a menos de un año (520/521): ahí va el capital de cada cuota.';
comment on column public.recurring_contract.treasury_account_id is 'S01d. El banco donde se carga la cuota.';
comment on column public.recurring_contract.principal is 'S01d. El importe prestado o aplazado: el capital del cuadro tiene que sumarlo.';
comment on column public.recurring_contract.document_name is 'S01d. El cuadro o la resolución que se leyó (nombre del fichero).';
