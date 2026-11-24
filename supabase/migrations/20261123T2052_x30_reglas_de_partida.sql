-- supabase/migrations/20261123T2052_x30_reglas_de_partida.sql
--
-- X30 · Las reglas de partida, también para las empresas que ya existen (respuesta X30 · 1, C): las que tienen alguna
-- cuenta de banco, con applies_from = ahora. Así no tocan nada de lo que ya está: solo miran lo que entre en el banco
-- desde la tanda, o lo que alguien les pida al aplicarlas hacia atrás. Proponen en ámbar hasta que la empresa las
-- confirme; nunca concilian solas desde el primer día. Solo AÑADE filas nuevas en bank_rule y su registro.
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: borra las reglas de partida que aún no han
-- conciliado nada (y su registro, en cascada).

select c.id, public._bank_reglas_de_partida(c.id, now()) as reglas
  from public.company c
 where exists (select 1 from public.treasury_account t where t.company_id = c.id and t.kind = 'bank')
   and not exists (select 1 from public.bank_rule r where r.company_id = c.id and r.seed = 'partida');
