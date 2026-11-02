-- Vuelta atrás de 20261031T2212_b01rv_revolut_en_el_dia.sql
-- bank_importar, restaurada del respaldo que guardó la 2212 (_restaurar_funcion
-- comprueba la huella): la de la B02, que para la continuidad solo mira el
-- extracto anterior que acaba antes del día en que empieza el nuevo.
select public._restaurar_funcion('public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)', '20261031T2212_b01rv_revolut_en_el_dia');
