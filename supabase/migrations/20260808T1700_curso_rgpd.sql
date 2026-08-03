-- ============================================================================
-- Folvy · CURSO "Protección de datos (RGPD) en el trabajo"
-- Molde didáctico de docs/folvy_formacion_guia_contenido.md · OLEADA 2
-- ----------------------------------------------------------------------------
-- FUENTE PRINCIPAL: Guía de la AEPD "Protección de datos y relaciones laborales"
-- (elaborada con el Ministerio de Trabajo, la patronal y los sindicatos).
-- Cubre: bases que legitiman el tratamiento, minimización, deberes de secreto y
-- seguridad, videovigilancia, consulta de redes sociales del trabajador,
-- sistemas internos de denuncias, registro de jornada y datos de víctimas de
-- acoso.
--
-- ⚠️ REEVALUACIÓN 12 MESES (no 24): la AEPD recomienda periodicidad MÍNIMA
--    ANUAL, alineada con los tratamientos reales de la empresa y DOCUMENTADA de
--    forma que pueda acreditarse ante la autoridad de control. Es exactamente lo
--    que hace Folvy (formar + evidencia firmada + reevaluar).
--
-- MARCO: RGPD (UE) 2016/679 · LOPDGDD 3/2018 · ET art. 20 bis (desconexión
-- digital) y art. 34.9 (registro de jornada).
--
-- ⚠️⚠️ REVISIÓN REFORZADA — status 'draft'. Contenido legal sensible: revisión
--    de Julio y preferiblemente de asesor. El curso NO sustituye al registro de
--    actividades de tratamiento ni a las políticas propias de cada empresa.
--
-- Correctas del test: b d c a b c d b a c (verificado)
-- DEPENDE DE: 20260806T1500_formacion_c1.sql · IDEMPOTENTE · Aplicada:
-- ============================================================================

do $guard$
begin
  if to_regclass('public.course') is null or to_regclass('public.course_section') is null
     or to_regclass('public.course_question') is null or to_regclass('public.course_option') is null then
    raise exception 'Faltan tablas de Formación C1.';
  end if;
end
$guard$;

do $seed$
declare
  v_course_id uuid;
  v_q uuid;
begin
  insert into public.course (
    account_id, code, title, summary, legal_basis, delivery_mode,
    reeval_months, is_mandatory, appcc_prerequisite, estimated_minutes,
    pass_threshold_pct, version, status
  ) values (
    null, 'proteccion_datos_rgpd',
    'Protección de datos (RGPD) en el trabajo',
    'Qué datos manejas sin darte cuenta, qué puedes hacer con ellos y qué no, y qué hacer si se pierde un móvil o alguien pide sus datos. Con lo que dice la AEPD sobre cámaras, WhatsApp y fichaje.',
    'RGPD (UE) 2016/679 · LOPDGDD 3/2018 · Guía AEPD relaciones laborales',
    'folvy_imparte', 12, true, false, 25, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'proteccion_datos_rgpd' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Manejas más datos de los que crees',
$md$"Protección de datos" suena a cosa de oficinas y abogados. Pero en un turno normal pasan por tus manos un montón de datos personales:

- El **teléfono y la dirección** del cliente del pedido a domicilio.
- Los **datos de la reserva**: nombre, móvil, a veces alergias (que son **datos de salud**).
- El **cuadrante** con los nombres y turnos de tus compañeros.
- Las **imágenes** de las cámaras del local.
- Tu **fichaje** y el de los demás.

Un **dato personal** es cualquier información que permita identificar a una persona. No solo el DNI: un teléfono, una matrícula, una foto o una dirección lo son.

Y hay datos con **protección reforzada**, las llamadas categorías especiales: salud, orientación sexual, religión, ideología, origen étnico, datos biométricos. **Las alergias de un cliente son datos de salud.** Se usan para hacer bien su plato, no para nada más.

La idea que ordena todo lo demás es sencilla: **los datos son de la persona, no de la empresa ni tuya.** La empresa los custodia para una finalidad concreta y tú los usas solo para hacer tu trabajo.

**En tu turno esto pasa así:** llega un pedido con el teléfono de una clienta. Usarlo para avisar de que el repartidor está abajo es tu trabajo. Guardarlo para escribirle luego por WhatsApp es una infracción grave — y de las que acaban en denuncia.

> **Marco legal** — RGPD (UE) 2016/679, art. 4: definición de dato personal y tratamiento. Art. 9: categorías especiales (salud, orientación sexual, ideología, origen étnico, biometría) con protección reforzada. LOPDGDD 3/2018.$md$),

  (v_course_id, 2, 'Solo lo necesario, solo para lo que es',
$md$Dos principios explican el 90% de las decisiones del día a día.

**Minimización.** Solo se recogen los datos necesarios para la finalidad. Ni uno más. Para una reserva hacen falta nombre, teléfono y número de personas. **No hace falta el DNI**, ni la fecha de nacimiento, ni el correo si no vas a usarlo.

Y la AEPD lo dice también para dentro: **la empresa no puede pedir más datos de los necesarios en ninguna fase de la relación laboral.** En una entrevista de trabajo no se pregunta si tienes hijos, si estás embarazada o cuál es tu situación de salud.

**Limitación de la finalidad.** Los datos recogidos para una cosa no se usan para otra. El teléfono que un cliente dio para un pedido **no sirve** para mandarle promociones, salvo que haya aceptado expresamente recibirlas. Son dos finalidades distintas y hacen falta dos permisos.

Y hay dos deberes que te afectan directamente:

**Deber de secreto.** Lo que ves por tu trabajo no se cuenta fuera. Que tal persona vino a cenar, con quién, o qué encargó. Este deber **continúa aunque dejes la empresa**.

**Deber de seguridad.** No dejar la lista de reservas con teléfonos a la vista en la barra, no dejar la sesión abierta en un ordenador compartido, no llevarte datos a tu móvil personal.

**En tu turno esto pasa así:** el caso más habitual y más peligroso es la lista de reservas impresa en el atril, con nombres y teléfonos a la vista de cualquiera que pase. Es una brecha de seguridad de manual, y no cuesta nada evitarla.

> **Datos técnicos** — RGPD, art. 5: licitud, lealtad y transparencia; limitación de la finalidad; minimización de datos; exactitud; limitación del plazo de conservación; integridad y confidencialidad. Art. 5.1.f y art. 32: deber de seguridad. El deber de secreto pervive tras la extinción de la relación laboral.$md$),

  (v_course_id, 3, 'Cámaras, WhatsApp y fichaje: lo que se puede y lo que no',
$md$Aquí es donde más dudas hay, y donde la AEPD ha sido más clara.

**Cámaras de videovigilancia.** Se pueden poner para seguridad y control laboral, pero con condiciones:
- Hay que **informar previamente** a la plantilla y a la representación de los trabajadores, y colocar el cartel informativo.
- **Nunca en zonas de descanso, vestuarios ni baños.** Ahí no hay excepción posible.
- **Sin audio**, salvo casos muy justificados: grabar conversaciones es mucho más invasivo.
- Las imágenes se conservan un tiempo limitado y las ve quien tiene que verlas, no cualquiera.

**El móvil y el ordenador de la empresa.** La empresa puede establecer una política de uso y realizar controles, pero **tiene que haberlo comunicado antes**: qué se puede usar, qué controles se harán y qué consecuencias tienen. No vale revisar sin avisar.

**Tus redes sociales.** La empresa **no puede** rastrear tu perfil personal para tomar decisiones sobre ti. Tu vida privada es tuya.

**Desconexión digital.** Tienes derecho a no estar disponible fuera de tu jornada. El grupo de WhatsApp del equipo es cómodo, pero **no convierte tu tiempo libre en tiempo de trabajo**.

**El registro de jornada** (obligatorio) recoge tus horas. Sirve para eso, no para vigilarte minuto a minuto.

**En tu turno esto pasa así:** el grupo de WhatsApp del local. Se cuelan fotos de compañeros sin permiso, se comparten teléfonos de clientes para "avisar de un pedido", y se piden favores a las once de la noche. Ninguna de esas tres cosas debería pasar, y las tres pasan en casi todos los locales.

> **Datos técnicos** — LOPDGDD, art. 89: videovigilancia laboral con deber de información previa; prohibición en lugares destinados al descanso o esparcimiento (vestuarios, aseos, comedores). Art. 87-88: uso de dispositivos digitales y derecho a la intimidad; art. 88 y ET art. 20 bis: desconexión digital. ET art. 34.9: registro diario de jornada.$md$),

  (v_course_id, 4, 'Los derechos de la gente (y qué hacer si alguien los ejerce)',
$md$Cualquier persona —un cliente, un compañero, tú mismo— puede pedir cosas sobre sus datos. Son los llamados **derechos ARCO-POL**:

- **Acceso** — saber qué datos suyos tenéis.
- **Rectificación** — corregir lo que esté mal.
- **Supresión** — el "derecho al olvido": que se borren.
- **Oposición** — que se deje de usar para algo concreto.
- **Limitación** — que se conserven pero no se usen mientras se resuelve algo.
- **Portabilidad** — llevárselos a otro sitio.

**¿Qué tienes que hacer tú si alguien te lo pide en la barra?** No resolverlo tú. **Recoge la petición y pásala a tu responsable**, que sabrá cómo tramitarla. Hay un plazo legal de un mes para responder, así que no se puede dejar en un cajón ni decirle al cliente que "escriba a no sé dónde".

Y esto es importante: **tú también tienes esos derechos frente a tu empresa.** Puedes pedir qué datos tuyos tienen, o acceder a las imágenes de una cámara que te grabó.

**Sobre el consentimiento:** no siempre hace falta. Para pagarte la nómina no hace falta tu permiso: la base legal es el contrato. Pero para mandarte publicidad, o para usar tu foto en las redes del restaurante, **sí hace falta que digas que sí**, y puedes retirarlo cuando quieras.

**En tu turno esto pasa así:** hacéis una foto del equipo para el Instagram del local. Si alguien no quiere salir, **no sale**, y no pasa nada. Publicar su cara sin permiso es un tratamiento de datos sin base legal, por muy buen rollo que haya.

> **Datos técnicos** — RGPD, arts. 15-22: derechos de acceso, rectificación, supresión, limitación, portabilidad y oposición. Plazo de respuesta: un mes, prorrogable en casos complejos. Art. 7: el consentimiento debe ser libre, específico, informado e inequívoco, y retirable en cualquier momento.$md$),

  (v_course_id, 5, 'Cuando algo se pierde o se filtra',
$md$Una **brecha de seguridad** es cualquier incidente que deje datos personales expuestos, perdidos o alterados. No hace falta un hacker: la mayoría son mucho más tontas.

- El móvil de empresa con la app de pedidos, olvidado en un taxi.
- El portátil de la oficina, robado.
- La lista de reservas con teléfonos, tirada en la basura sin destruir.
- Un correo con la lista de clientes enviado a la dirección equivocada.
- Alguien que entra con la sesión que otro dejó abierta.

**🔴 Lo que tienes que hacer: avisar de inmediato.** Y esto tiene una razón muy concreta: si la brecha supone un riesgo, **la empresa tiene 72 horas para comunicarla a la AEPD**. Ese reloj empieza cuando la empresa se entera. Si tú tardas dos días en decirlo "por vergüenza", te has comido la mitad del plazo.

**Ocultar una brecha es mucho peor que la brecha.** El fallo de perder un móvil se entiende; ocultarlo, no, y multiplica la sanción.

**Cómo evitarlas, en cuatro gestos:** bloquea la sesión al levantarte, no uses tu móvil personal para datos del trabajo, destruye el papel con datos en vez de tirarlo entero, y comprueba el destinatario antes de enviar un correo.

**En tu turno esto pasa así:** el ordenador de la oficina del local, con la sesión abierta y la lista de personal en pantalla, mientras entra y sale gente. Nadie lo vive como un problema de seguridad porque "somos todos del equipo". Es exactamente una brecha esperando a ocurrir.

> **Datos técnicos** — RGPD, arts. 33 y 34: notificación de la violación de seguridad a la autoridad de control sin dilación indebida y, de ser posible, en un plazo máximo de 72 horas; comunicación a los interesados cuando entrañe un alto riesgo para sus derechos y libertades.$md$),

  (v_course_id, 6, 'Por qué esto se repite cada año',
$md$Puede que este curso te suene el año que viene. No es un error: **la AEPD recomienda que esta formación se repita con periodicidad mínima anual**, esté alineada con los tratamientos reales de la empresa y quede documentada de forma que pueda acreditarse ante la autoridad de control.

O sea: no basta con haberlo explicado una vez. Hay que poder **demostrar** que se explicó, a quién y cuándo. Por eso firmas al final.

**Lo que se juega la empresa:** las sanciones del RGPD son de las más altas del ordenamiento —pueden llegar a millones de euros en los casos graves—, y la AEPD publica las resoluciones, así que también hay un coste reputacional. Pero la mayoría de expedientes no vienen de grandes filtraciones: vienen de **una cámara mal puesta, un cartel que falta o un correo mal enviado**.

**Las cinco reglas que resumen todo el curso:**
1. Solo los datos necesarios, solo para lo que son.
2. Lo que ves por tu trabajo, no se cuenta fuera. Tampoco después de irte.
3. Nada de datos del trabajo en tu móvil personal.
4. Si alguien te pide sus datos, pásalo a tu responsable ese mismo día.
5. Si algo se pierde o se filtra, **avisa ya**. El reloj de 72 horas corre.

**Antes de terminar**, una pregunta práctica para tu responsable: **¿a quién se avisa en tu empresa si hay un incidente con datos?** Si no lo sabes, este curso no habrá servido del todo.

> **Datos técnicos** — Guía AEPD "Protección de datos y relaciones laborales": la formación debe estar alineada con los tratamientos reales de la empresa, ser periódica (mínimo anual recomendado) y documentarse de forma acreditable ante la autoridad de control. RGPD, art. 39.1.b: la formación del personal que participa en las operaciones de tratamiento es una de las funciones del delegado de protección de datos.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b d c a b c d b a c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Llega un pedido a domicilio con el teléfono de una clienta. Te ha parecido simpática y quieres escribirle luego. ¿Puedes?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, el teléfono ya lo tengo por el trabajo.', false, 'Tenerlo por el trabajo no te autoriza a usarlo para otra cosa.'),
   (v_q, 'No: ese dato se dio para gestionar el pedido y solo puede usarse para eso.', true, 'Correcto. Es el principio de limitación de la finalidad, y usarlo así es una infracción grave.'),
   (v_q, 'Sí, si le escribo desde mi móvil personal y no desde el de empresa.', false, 'El soporte da igual: el problema es el uso del dato.'),
   (v_q, 'Sí, si solo le escribo una vez.', false, 'Una sola vez sigue siendo un uso no autorizado.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Un cliente hace una reserva por teléfono. ¿Qué datos le pides?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Nombre, teléfono, DNI y fecha de nacimiento, por si acaso.', false, 'DNI y fecha de nacimiento no son necesarios para una reserva.'),
   (v_q, 'Todos los que quiera darme voluntariamente.', false, 'Aunque los dé, no puedes recoger lo que no necesitas.'),
   (v_q, 'Nombre y DNI, que es lo que identifica de verdad.', false, 'El DNI es excesivo: con nombre y teléfono se gestiona la reserva.'),
   (v_q, 'Nombre, teléfono y número de personas: lo necesario para la reserva y nada más.', true, 'Correcto. Es el principio de minimización.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, '¿Dónde NO se puede instalar una cámara de videovigilancia en el local?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'En la cocina, porque se trabaja con alimentos.', false, 'En zonas de trabajo sí es posible, informando previamente.'),
   (v_q, 'En la entrada, porque graba a los clientes.', false, 'Es una de las ubicaciones habituales y admisibles.'),
   (v_q, 'En vestuarios, aseos y zonas de descanso: ahí está prohibido sin excepción.', true, 'Correcto. Son lugares destinados al descanso o esparcimiento y no admiten cámara.'),
   (v_q, 'En el almacén, porque hay poco tránsito.', false, 'El almacén puede videovigilarse informando debidamente.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Un compañero pierde el móvil de empresa con la app de pedidos y los datos de clientes. ¿Qué debe hacer?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Avisar de inmediato al responsable, aunque dé apuro.', true, 'Correcto. La empresa tiene 72 horas para notificar a la AEPD, y ese reloj empieza cuando se entera.'),
   (v_q, 'Esperar un par de días por si aparece antes de decir nada.', false, 'Se come la mitad del plazo legal. Ocultarlo agrava mucho el problema.'),
   (v_q, 'No decir nada si el móvil tenía código de desbloqueo.', false, 'El código reduce el riesgo, pero la decisión de valorarlo no es suya.'),
   (v_q, 'Comprar otro móvil y seguir como si nada.', false, 'El dispositivo perdido sigue conteniendo datos personales expuestos.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Un cliente pide que borréis todos sus datos. Estás en la barra y hay lío. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le digo que ya está borrado para quitármelo de encima.', false, 'Es mentir sobre el ejercicio de un derecho: agrava cualquier reclamación.'),
   (v_q, 'Recojo su petición y se la paso a mi responsable ese mismo día.', true, 'Correcto. Hay un plazo legal de un mes para responder; el trámite no es tuyo, pero el aviso sí.'),
   (v_q, 'Le digo que escriba a la central, que yo no llevo eso.', false, 'Dejarlo sin cauce es no atender el derecho. Hay que recoger la petición.'),
   (v_q, 'Borro yo lo que encuentre en el sistema.', false, 'Borrar por tu cuenta puede destruir información que hay obligación de conservar.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Hacéis una foto del equipo para el Instagram del local y un compañero no quiere salir.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sale igual: es una foto de trabajo en horario laboral.', false, 'El contrato no incluye ceder tu imagen para publicidad.'),
   (v_q, 'Sale igual pero se le difumina la cara.', false, 'Si no quiere salir, la solución es que no salga, no editarlo después.'),
   (v_q, 'No sale, y no pasa nada: publicar su imagen necesita su consentimiento, que además puede retirar.', true, 'Correcto. El consentimiento debe ser libre y es revocable en cualquier momento.'),
   (v_q, 'Sale si lo decide la mayoría del equipo.', false, 'Los derechos personales no se votan.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'En el grupo de WhatsApp del equipo alguien comparte el teléfono de un cliente para avisar de un pedido. ¿Es correcto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, es más rápido y es para trabajar.', false, 'La finalidad laboral no justifica sacar el dato de los sistemas de la empresa.'),
   (v_q, 'Sí, mientras se borre el mensaje después.', false, 'El dato ya ha quedado en los móviles personales de todo el grupo.'),
   (v_q, 'Sí, si el grupo es solo de trabajadores.', false, 'Sigue siendo una difusión no controlada a dispositivos personales.'),
   (v_q, 'No: los datos de clientes se manejan en los sistemas de la empresa, no en móviles personales de todo el equipo.', true, 'Correcto. Es una brecha de seguridad, aunque la intención sea buena.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Un cliente avisa de que es alérgico a los frutos secos. ¿Qué tipo de dato es y cómo se trata?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Es un dato normal: se puede comentar libremente en el local.', false, 'Es un dato de salud, con protección reforzada.'),
   (v_q, 'Es un dato de salud, de categoría especial: se usa solo para preparar bien su plato y no se comenta fuera de ese fin.', true, 'Correcto. Se usa para el servicio, no se difunde ni se guarda para otros usos.'),
   (v_q, 'Es un dato de salud, así que no podemos ni anotarlo.', false, 'Sí se puede tratar: es necesario para prestar el servicio con seguridad.'),
   (v_q, 'Es un dato del establecimiento, no del cliente.', false, 'Los datos son siempre de la persona, no del negocio.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Dejas la empresa. ¿Qué pasa con lo que sabes de clientes y compañeros?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'El deber de secreto continúa: no puedo contarlo ni usarlo después de irme.', true, 'Correcto. El deber de confidencialidad pervive tras la extinción del contrato.'),
   (v_q, 'Al terminar el contrato ya puedo hablar libremente.', false, 'El deber de secreto no caduca con el contrato.'),
   (v_q, 'Puedo llevarme la lista de clientes: yo la ayudé a construir.', false, 'Llevarse datos de la empresa es una infracción, y grave.'),
   (v_q, 'Depende de si firmé algo específico.', false, 'El deber deriva de la ley, no solo de lo que se firme.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Por qué esta formación se repite cada año?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Porque la ley cambia todos los años.', false, 'La normativa base es estable; la razón es otra.'),
   (v_q, 'Por costumbre de las empresas grandes.', false, 'No es costumbre: es una recomendación expresa de la autoridad de control.'),
   (v_q, 'Porque la AEPD recomienda periodicidad mínima anual y que quede documentada de forma acreditable ante la autoridad de control.', true, 'Correcto. No basta con explicarlo: hay que poder demostrar a quién y cuándo. Por eso firmas.'),
   (v_q, 'Porque así se justifica el presupuesto de formación.', false, 'La razón es de cumplimiento y de eficacia, no presupuestaria.');

  raise notice 'Curso RGPD sembrado (draft, revisión reforzada). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.reeval_months,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='proteccion_datos_rgpd' and c.account_id is null;
-- Esperado: draft · 12 · 6 secciones · 10 preguntas · 10 correctas.
