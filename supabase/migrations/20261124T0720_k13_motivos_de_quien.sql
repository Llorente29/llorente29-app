-- supabase/migrations/20261124T0720_k13_motivos_de_quien.sql
--
-- K13 · «Asientos al día» no salía en la línea de estado de la gestoría (Julio, 24/11, e2e 45344271594): no era una
-- regla, era un fallo de la base, y en producción está igual desde el E03 (18/11, medido en solo lectura).
--
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261124_k13_motivos_de_quien_prueba.sql
--   conta_motivos_para_validar corre con los permisos de quien la llama (no es security definer) y, para una recibida,
--   pregunta a nombre de quién va con public._conta_de_quien, que es interna: solo la ejecuta service_role. Llamada por
--   una persona (conta_esperan → conta_pendientes, el contador de los asientos), da «permission denied for function
--   _conta_de_quien»; conta_pendientes lo atrapa y el número de asientos sale null («no se ha podido contar»), así que
--   la línea de estado no dice nada de los asientos. Pasa en cuanto la empresa tiene un asiento de una recibida sin
--   validar.
--   Desde aquí llama a public.conta_de_quien_es, la de la pantalla: la misma respuesta, para una factura de tu cuenta
--   (o service_role), que es lo que hay aquí (el asiento ya es de la cuenta). Lo demás, igual.
--
-- Con la MISMA firma y su cuerpo vigente con las dos llamadas cambiadas; respaldo antes, para la vuelta atrás. Nada en
-- el camino del pedido. No escribe en ninguna fila.

select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261124T0720_k13_motivos_de_quien');

do $$
declare
  v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure);
  v_viejo constant text := 'public._conta_de_quien(v_e.source_id)';
  v_n int;
begin
  if strpos(v_def, 'public.conta_de_quien_es(v_e.source_id)') > 0 and strpos(v_def, v_viejo) = 0 then return; end if;   -- ya pasada
  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 2 then
    raise exception 'K13: conta_motivos_para_validar no es la medida (% llamadas a _conta_de_quien, y eran 2): no se toca.', v_n;
  end if;
  execute replace(v_def, v_viejo, 'public.conta_de_quien_es(v_e.source_id)');
end $$;
