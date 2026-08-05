-- 20260805T1000_course_whatsapp_hook.sql
-- Gancho de WhatsApp por curso (texto ameno del aviso) + seed del catálogo global.

ALTER TABLE course ADD COLUMN IF NOT EXISTS whatsapp_hook text;

COMMENT ON COLUMN course.whatsapp_hook IS
  'Texto del aviso de WhatsApp al empleado (tono ameno). Nullable: sin gancho, no se envia aviso. Lo propone la IA al publicar; el admin lo edita.';

UPDATE course c SET whatsapp_hook = v.hook
FROM (VALUES
  ('manipulador_alimentos',   'Una olla caliente en la encimera "hasta que se enfríe sola"… ¿qué puede salir mal? Todo. Este curso es *obligatorio por ley* — y cuando lo hagas entenderás por qué. 🌡️'),
  ('alergenos_intolerancias', '"¿Lleva frutos secos?" — si dudas, este curso es para ti. Porque "creo que no" no es una respuesta válida con un alérgico delante. *Obligatorio para todos los que tocan alimentos*. 🥜'),
  ('appcc_prerrequisitos',    'APPCC suena a papeleo. Hasta que llega la inspección y pregunta por TU registro. Es *formación obligatoria* y te lo quitas en un rato. 📋'),
  ('igualdad_acoso',          'Algo que no debería hacer falta explicar, pero la ley dice que sí. Y tiene razón. *Obligatorio para toda la plantilla* — rápido e importante. 🤝'),
  ('prl_riesgos_laborales',   'Suelos mojados, aceite a 180°, cuchillos afilados. Tu cocina tiene riesgos reales. *Obligatorio por ley* — léelo y firma que lo has hecho. ⚠️'),
  ('proteccion_datos_rgpd',   'El teléfono de un cliente no es para tu WhatsApp personal. *Formación obligatoria de protección de datos* — rapidito y cumples. 🔒'),
  ('conservacion_etiquetado', 'Esa tarrina sin etiqueta en la cámara… ¿es de ayer o de la semana pasada? Exacto. Haz el curso. 🏷️'),
  ('embolsado_delivery',      'El cliente no ve tu cocina, ve tu bolsa. Si llega mal, da igual lo bien que cocines. 📦'),
  ('escandallo_fichas_tecnicas', 'La báscula no es decoración. Cada gramo de más es dinero que se va. ⚖️'),
  ('estacion_kds',            'La tablet pita, hay 6 pedidos y tú mirando la pantalla como si fuera Netflix. Aprende a dominarla. 📱'),
  ('incidencias_delivery',    'Pedido equivocado, cliente enfadado, plataforma reclamando. ¿Qué haces? Hay un protocolo y es rápido. 🚨'),
  ('inventario_conteo',       '"Quedan patatas." ¿Cuántas? "Algunas." Así no. Aprende a contar bien. 📊'),
  ('lgtbi_no_discriminacion', 'Igualdad y respeto en el trabajo. Necesario por ley y por sentido común. 🏳️‍🌈'),
  ('limpieza_cierre',         'Limpiar no es pasar el trapo. Desinfectar no es echar lejía a ojo. Este curso te enseña la diferencia. 🧹'),
  ('mermas_aprovechamiento',  'Lo que tiras también lo has pagado. Cada merma es margen que se evapora. 🗑️'),
  ('primeros_auxilios',       'Un compañero se corta, se quema o se marea. ¿Sabes qué hacer EN LOS PRIMEROS 2 MINUTOS? 🩹'),
  ('recepcion_pedidos',       'Lo que entra mal a tu cocina sale peor al plato. Tu última frontera. 🚛'),
  ('temperatura_ruta_delivery', 'La comida sale a 70°C de tu cocina. ¿A cuánto llega al cliente? La cadena de frío no se rompe sola. 🏍️'),
  ('canal_denuncias',         'Si ves algo que no está bien, hay un canal seguro para decirlo. Aquí te explicamos cómo. 📢')
) AS v(code, hook)
WHERE c.code = v.code AND c.account_id IS NULL;
