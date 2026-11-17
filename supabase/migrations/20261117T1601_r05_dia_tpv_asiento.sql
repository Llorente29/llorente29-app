-- supabase/migrations/20261117T1601_r05_dia_tpv_asiento.sql
--
-- R05 · Un día del TPV se valida como uno de Folvy: su enlace con el asiento
-- (encargo R05 y respuesta R05 · 1, 17/11).
--
-- Solo AÑADE: una columna que admite nulos y su índice (tabla nueva y pequeña).
--
--   conta_tpv_dia.entry_id: el asiento del día (nulo hasta que se valida). Al
--   validarse, el día pasa a «contabilizado» (respuesta R05 · 1, §4: un día queda
--   contabilizado al validarse) y conta_tpv_dia_guardar ya no lo deja sustituir
--   (esa parada es del R03). Si el asiento se anula, la 1603 lo devuelve a nulo.
--
-- Va aparte de la 1603 (el disparador, que CAMBIA journal_entry) para que en
-- staging vaya de verdad desde la rama (W05: solo añade), y la e2e del día del
-- TPV tenga la columna antes de fusionar.
--
-- Se puede pasar dos veces (if not exists).
-- Prueba: supabase/staging/sql/20261117_r05_dia_tpv_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261117T1601_r05_dia_tpv_asiento.down.sql

alter table public.conta_tpv_dia add column if not exists entry_id uuid references public.journal_entry(id) on delete set null;
create index if not exists conta_tpv_dia_asiento on public.conta_tpv_dia (entry_id) where entry_id is not null;
comment on column public.conta_tpv_dia.entry_id is
  'R05: el asiento del día, puesto al validarlo (conta_tpv_dia_validar). Si se anula, vuelve a nulo y el día a «guardado».';
