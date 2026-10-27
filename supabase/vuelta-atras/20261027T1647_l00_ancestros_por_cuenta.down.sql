-- supabase/vuelta-atras/20261027T1647_l00_ancestros_por_cuenta.down.sql
--
-- Vuelta atrás de 20261027T1647_l00_ancestros_por_cuenta (L00 · Respuesta 6).
-- kitchen_ancestors_of vuelve a ser EXACTAMENTE la de antes: el texto que la
-- migración guardó en funcion_respaldo; _restaurar_funcion comprueba la huella.
-- Con ella vuelve también lo de antes: la cascada de coste de un trabajador que
-- recibe un albarán se para, y los platos esperan a que la oficina lo confirme.

select public._restaurar_funcion('public.kitchen_ancestors_of(uuid)', '20261027T1647_l00_ancestros_por_cuenta');
