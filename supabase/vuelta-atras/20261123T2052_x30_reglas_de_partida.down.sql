-- supabase/vuelta-atras/20261123T2052_x30_reglas_de_partida.down.sql
-- X30 · Quita las reglas de partida que no han conciliado nada (su registro se va en cascada).
delete from public.bank_rule r
 where r.seed = 'partida'
   and not exists (select 1 from public.bank_match b where b.rule_id = r.id);
