-- K13 · vuelta atrás de 20261124T0720: conta_motivos_para_validar desde su respaldo (vuelve a llamar a la interna
-- _conta_de_quien). No toca ninguna fila.
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261124T0720_k13_motivos_de_quien');
