-- supabase/migrations/20261117T1603_r05_dia_tpv_anulado.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261117_r05_dia_tpv_prueba.sql
--
-- R05 · Si se anula el asiento de un día del TPV, el día vuelve a «guardado»
-- (respuesta R05 · 1, §4), para poder subirlo corregido y validarlo otra vez.
--
-- Añade una función y CAMBIA EN CALIENTE public.journal_entry: un disparador
-- nuevo (analizar.mjs: «disparador nuevo en una tabla que existe: cambia cómo se
-- escribe en ella»). journal_entry no está en el camino del pedido.
--
-- Por qué un disparador y no un cambio en journal_entry_anular o en
-- journal_entry_descartar: así no cambia ninguna función que existe. Descartar
-- no aplica: un día del TPV se propone y se valida en la misma transacción, así
-- que nunca queda «propuesto». El disparador solo mira asientos de ventas del día
-- que pasan a «anulado» (WHEN) y solo escribe en conta_tpv_dia: los de Folvy no
-- tienen fila allí, y el update no toca ninguna.
--
-- Se puede pasar dos veces (create or replace).
-- Vuelta atrás: supabase/vuelta-atras/20261117T1603_r05_dia_tpv_anulado.down.sql

create or replace function public._tg_conta_tpv_dia_anulado()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.conta_tpv_dia
     set estado = 'guardado', entry_id = null
   where entry_id = new.id and account_id = new.account_id;
  return null;
end
$function$;
comment on function public._tg_conta_tpv_dia_anulado() is
  'R05: al anular el asiento de un día del TPV, el día vuelve a «guardado» y sin asiento (se puede subir corregido y validar otra vez).';
revoke all on function public._tg_conta_tpv_dia_anulado() from public, anon, authenticated;

create or replace trigger trg_journal_entry_tpv_anulado
  after update of status on public.journal_entry
  for each row
  when (new.status = 'anulado' and old.status is distinct from 'anulado' and new.source_type = 'sales_day')
  execute function public._tg_conta_tpv_dia_anulado();
