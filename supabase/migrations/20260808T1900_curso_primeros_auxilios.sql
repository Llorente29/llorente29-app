-- ============================================================================
-- Folvy · CURSO "Primeros auxilios básicos en hostelería"
-- Molde didáctico de docs/folvy_formacion_guia_contenido.md · OLEADA 3
-- ----------------------------------------------------------------------------
-- ⚠️⚠️ LÍMITE DE ALCANCE — LEER ANTES DE PUBLICAR:
--   Este curso es de SENSIBILIZACIÓN Y ACTUACIÓN BÁSICA. NO sustituye a la
--   formación presencial en RCP y DESA, que se aprende con maniquí y con un
--   instructor acreditado. El propio curso lo dice de forma explícita al
--   trabajador (secciones 1 y 6).
--   · delivery_mode = 'mixto': la parte práctica (RCP/DESA) la imparte una
--     entidad externa acreditada y su certificado se ARCHIVA en Folvy.
--   · La designación de personal de emergencias (art. 20 LPRL) y su formación
--     corresponde al ámbito de PRL → servicio de prevención, NO Folvy.
--
-- MARCO: Ley 31/1995 (LPRL) art. 20 — medidas de emergencia y primeros auxilios;
-- guías del Consejo Español de RCP y ERC 2021 para las maniobras básicas.
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'. Contenido sanitario:
--    conviene validación por profesional sanitario o formador acreditado en SVB.
--
-- Correctas del test: b c a d b a c b d c (verificado)
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
    null, 'primeros_auxilios',
    'Primeros auxilios básicos en hostelería',
    'Qué hacer en los primeros minutos ante un atragantamiento, una quemadura, un corte o una reacción alérgica grave. No sustituye a la formación práctica en RCP, pero puede salvar una vida mientras llega la ayuda.',
    'Ley 31/1995 (LPRL), art. 20 · Recomendaciones ERC/CERCP',
    'mixto', 24, false, false, 25, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes,
    delivery_mode = excluded.delivery_mode
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'primeros_auxilios' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Lo primero: qué es este curso y qué no',
$md$Empecemos siendo claros, porque aquí la honestidad importa más que en ningún otro curso.

**Esto no te convierte en socorrista.** Las maniobras de reanimación se aprenden con las manos, sobre un maniquí y con un instructor delante. Si tu empresa te ofrece ese curso, hazlo: no hay sustituto.

**Lo que sí hace este curso** es prepararte para los primeros minutos, que son los que deciden. Que sepas reconocer una urgencia, que no te bloquees, y que hagas las tres o cuatro cosas que de verdad importan mientras llega la ayuda.

En hostelería hay más urgencias de las que parece: gente comiendo (atragantamientos), fuego y aceite a 180 grados (quemaduras), cuchillos y mandolinas (cortes), alergias alimentarias (anafilaxia), y clientes de todas las edades.

**La secuencia que ordena cualquier emergencia, en tres pasos: PROTEGER · AVISAR · SOCORRER.**

1. **Proteger** — Que no haya más víctimas, empezando por ti. Apaga el fuego, corta la freidora, aparta el peligro. Un socorrista accidentado no ayuda a nadie.
2. **Avisar** — **112**. Es gratuito, funciona sin cobertura de tu operador y desde cualquier móvil. Da la dirección exacta, qué ha pasado y cuántos afectados. **No cuelgues** hasta que te lo digan: te van a guiar.
3. **Socorrer** — Solo lo que sepas hacer.

**En tu turno esto pasa así:** lo que más falla no es la técnica, es que **nadie llama**. Todo el mundo mira, alguien dice "¿llamamos?", y pasan dos minutos. Por eso se señala a una persona concreta: *"tú, el de la camisa azul, llama al 112"*. Si no señalas a nadie, nadie llama.

> **Marco legal** — Ley 31/1995 (LPRL), art. 20: la empresa debe analizar las posibles situaciones de emergencia y designar al personal encargado de poner en práctica las medidas de primeros auxilios, con la formación y el material adecuados. Esa designación y su formación específica corresponden al servicio de prevención.$md$),

  (v_course_id, 2, 'Atragantamiento: la urgencia más probable en un comedor',
$md$Es la emergencia más frecuente donde se come. Y lo primero es distinguir dos situaciones, porque el error aquí es grave.

**Si tose con fuerza, habla o respira**: la vía está parcialmente libre. **No le des golpes, no le metas la mano en la boca.** Anímale a toser: la tos es el mecanismo más eficaz que existe. Quédate a su lado y vigila.

**Si NO puede toser, ni hablar, ni respirar**, se lleva las manos al cuello y se le pone la cara azulada: obstrucción completa. Ahí hay que actuar.

1. **Pide ayuda y que alguien llame al 112.**
2. **Cinco golpes secos entre los omóplatos**, con el talón de la mano, inclinando a la persona hacia delante.
3. Si no sale, **cinco compresiones abdominales** (maniobra de Heimlich): por detrás, puño por encima del ombligo y bajo el esternón, la otra mano encima, y tirar hacia dentro y hacia arriba.
4. **Alterna 5 y 5** hasta que expulse el objeto o pierda la consciencia.
5. **Si pierde la consciencia**: al suelo y RCP, y que traigan el desfibrilador si hay.

**Casos especiales:** en **embarazadas y personas obesas**, las compresiones van en el **centro del pecho**, no en el abdomen. En **bebés menores de un año**, nunca Heimlich: 5 golpes en la espalda boca abajo y 5 compresiones en el pecho con dos dedos.

**En tu turno esto pasa así:** el error clásico es dar golpes en la espalda a alguien que está tosiendo bien. Puedes hacer que el trozo baje y empeorar una situación que se iba a resolver sola. **Si tose, deja que tosa.**

> **Datos técnicos** — Recomendaciones del European Resuscitation Council: obstrucción parcial (tos eficaz) → animar a toser sin intervenir; obstrucción completa → alternar 5 golpes interescapulares y 5 compresiones abdominales; si pierde consciencia → iniciar RCP y activar el sistema de emergencias.$md$),

  (v_course_id, 3, 'Cuando alguien se desploma',
$md$Si una persona cae y no responde, actúa en este orden. Son segundos que cuentan.

1. **Comprueba si responde.** Sacúdele suavemente los hombros y pregúntale en voz alta.
2. **Mira si respira normal.** Abre la vía aérea (frente-mentón) y observa el pecho **10 segundos**. Ojo: unas boqueadas agónicas ruidosas **no son respiración normal**. Si dudas, actúa como si no respirara.
3. **Si no respira: 112 y RCP.** Manos libres o altavoz, para que te guíen.
4. **Compresiones**: centro del pecho, talón de una mano y la otra encima, brazos rectos. **Fuerte y rápido: unas 100-120 por minuto y unos 5 cm de profundidad.** Deja que el pecho suba entre compresión y compresión. Es agotador: **relévate con otra persona cada dos minutos** si podéis.
5. **Si hay desfibrilador (DESA), que alguien lo traiga.** Se enciende y **habla**: te dice exactamente qué hacer y **solo descarga si hace falta**. No puedes hacer daño con él.
6. **No pares** hasta que llegue la ayuda o la persona respire con normalidad.

**Si respira pero no responde**: colócala de lado (posición lateral de seguridad) para que no se ahogue con un vómito, y vigila que siga respirando.

**Y algo que hay que decir claro:** en una parada, **hacer compresiones imperfectas es infinitamente mejor que no hacer nada**. El miedo a "hacerlo mal" o a romper una costilla mata más gente que las costillas rotas. Sin compresiones, el desenlace es seguro.

**En tu turno esto pasa así:** una parada en un comedor lleno paraliza a todo el mundo. Alguien tiene que romper el bloqueo. Ese alguien puedes ser tú, aunque solo sepas apretar en medio del pecho y contar.

> **Datos técnicos** — Soporte Vital Básico (ERC 2021): comprobar respuesta, abrir vía aérea, comprobar respiración ≤10 s, activar emergencias, compresiones torácicas 100-120/min con profundidad de 5-6 cm, minimizar interrupciones, usar DESA en cuanto esté disponible. Este contenido es informativo: la competencia se adquiere con formación práctica.$md$),

  (v_course_id, 4, 'Quemaduras y cortes: el pan de cada día en cocina',
$md$**QUEMADURAS.** Aceite, plancha, vapor, horno.

- **Agua fría del grifo (no helada) sobre la zona, 20 minutos.** Es la medida más eficaz y la que más se acorta por prisa. Veinte minutos de verdad.
- **Retira anillos, pulseras y reloj** antes de que la zona se hinche.
- **Cubre con un paño limpio o gasa estéril**, sin apretar.
- **NUNCA**: hielo directo, pasta de dientes, aceite, mantequilla, vinagre ni remedios caseros. Y **no revientes las ampollas**.
- **Al hospital si**: la quemadura es mayor que la palma de la mano de la persona, es profunda (piel blanca o acartonada, o no duele — mala señal), o afecta a **cara, manos, pies, genitales o articulaciones**.
- Si la ropa está pegada a la piel, **no tires de ella**.

**CORTES.** Cuchillo, mandolina, cristal, abrelatas.

- **Presiona directamente** sobre la herida con un paño limpio. La presión es lo que para la hemorragia.
- **Eleva la zona** por encima del corazón si es un brazo o una mano.
- **Si empapa, no quites el apósito**: pon otro encima y sigue presionando.
- **No uses torniquete** salvo hemorragia masiva que no cede y con formación para hacerlo.
- **Si hay un objeto clavado, NO lo saques**: puede estar taponando el vaso. Inmoviliza alrededor y al hospital.
- **Al hospital si**: la hemorragia no se corta, el corte es profundo o abierto, hay pérdida de sensibilidad o movilidad, o la última vacuna del tétanos es antigua.
- **Si se amputa un dedo**: recógelo, envuélvelo en un paño limpio, mételo en una bolsa cerrada y esa bolsa en otra con hielo. **Nunca el dedo en contacto directo con el hielo.**

**En tu turno esto pasa así:** con una quemadura, casi nadie aguanta los 20 minutos bajo el agua: se ponen dos, se tapan con un guante y se sigue trabajando. Esos 20 minutos son la diferencia entre una marca que desaparece y una cicatriz para siempre.

> **Datos técnicos** — Enfriamiento con agua corriente a 15-25 °C durante 20 minutos; contraindicado el hielo directo por riesgo de lesión por frío. Ante amputación: conservación en frío indirecto, sin contacto del tejido con el hielo. Toda quemadura de segundo grado extensa o en zonas especiales requiere valoración médica.$md$),

  (v_course_id, 5, 'Reacción alérgica grave: aquí los minutos son todo',
$md$Esta es la urgencia que más directamente conecta con tu trabajo, porque puede desencadenarla un plato que ha salido de tu cocina.

**Señales de anafilaxia** (la reacción alérgica grave):
- Hinchazón de labios, lengua o garganta.
- Dificultad para respirar, pitos al respirar, voz ronca.
- Ronchas extendidas por el cuerpo.
- Mareo, palidez, sensación de desmayo.
- Vómitos o dolor abdominal intenso junto a lo anterior.

**Qué hacer:**
1. **112 inmediatamente.** No esperes a ver si mejora: la anafilaxia progresa en minutos.
2. **Si la persona lleva autoinyector de adrenalina**, que lo use ella o quien la acompañe. **Se pone en el muslo, incluso sobre la ropa.** Ayúdale a buscarlo en el bolso si hace falta.
3. **Túmbala con las piernas elevadas.** Si le cuesta respirar, mejor semisentada. **Que no se levante de golpe**: puede provocar una bajada de tensión brusca.
4. **No le des de beber ni de comer.**
5. **No la dejes sola** y vigila si deja de respirar.
6. **Guarda el plato y el envase.** Es información clave para el hospital y para saber qué pasó.

**Aunque mejore con la adrenalina, tiene que ir al hospital**: la reacción puede volver horas después.

**En tu turno esto pasa así:** el momento peligroso es la duda. "A ver si se le pasa", "igual es que le ha sentado mal". Cuando hay hinchazón de labios o dificultad para respirar, **no hay que valorar nada: se llama al 112**. Nadie te va a reprochar haber llamado de más.

> **Datos técnicos** — La anafilaxia es una reacción de instauración rápida y potencialmente mortal. Adrenalina intramuscular en cara anterolateral del muslo como tratamiento de primera línea. Riesgo de reacción bifásica: obligada valoración y observación hospitalaria aunque haya mejoría inicial.$md$),

  (v_course_id, 6, 'Prepararse antes de que pase',
$md$Las emergencias se resuelven con lo que se preparó antes, no con improvisación.

**Cosas que deberías saber ya, sin buscarlas:**
- **Dónde está el botiquín** y qué hay dentro. Que no le falte lo básico y que nada esté caducado.
- **Si hay desfibrilador (DESA)** en el local o en el centro comercial, y dónde.
- **La dirección exacta del local**, tal cual hay que dárselo al 112. Parece obvio, pero mucha gente no sabe decir el portal exacto bajo presión.
- **Quién está designado** para emergencias en tu empresa.

**El botiquín básico**: guantes desechables, gasas estériles, vendas, esparadrapo, suero fisiológico, tiritas azules (para cocina, que se vean si caen), tijeras y una manta térmica. **Sin medicamentos**: no se da a nadie ni un ibuprofeno.

**Cinco cosas que nunca se hacen:**
1. Dar medicamentos por tu cuenta.
2. Mover a alguien con sospecha de lesión en la espalda o el cuello, salvo peligro inmediato.
3. Dar de beber a quien no está plenamente consciente.
4. Sacar objetos clavados.
5. Dejar sola a una persona inconsciente.

**Y esto es importante**: te dijimos al empezar que este curso no te convierte en socorrista, y lo repetimos al acabar. **Apúntate al curso presencial de RCP y DESA si tienes ocasión.** Se hace en pocas horas, se practica sobre maniquí, y es de las pocas cosas que se aprenden en una mañana y pueden salvarle la vida a alguien — dentro o fuera del trabajo.

**Antes de terminar**: comprueba hoy mismo **dónde está el botiquín de tu local y si hay desfibrilador cerca**. Si no lo sabes, este curso no habrá servido del todo.

> **Datos técnicos** — LPRL art. 20: el empresario debe designar al personal encargado de las medidas de emergencia y primeros auxilios, comprobar periódicamente su correcto funcionamiento y organizar las relaciones necesarias con los servicios externos. La formación práctica en soporte vital básico y DESA la imparte entidad acreditada; su certificado se archiva como formación externa.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b c a d b a c b d c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Un cliente se atraganta pero tose con fuerza y puede hablar entre golpes de tos. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le doy cinco golpes fuertes en la espalda de inmediato.', false, 'Con tos eficaz puedes hacer que el objeto baje y empeorar la situación.'),
   (v_q, 'Le animo a seguir tosiendo, me quedo a su lado y vigilo por si empeora.', true, 'Correcto. La tos es el mecanismo más eficaz que existe. Si tose, deja que tosa.'),
   (v_q, 'Le meto los dedos en la boca para sacar lo que sea.', false, 'Puedes empujar el objeto más adentro. Nunca a ciegas.'),
   (v_q, 'Le doy agua para ayudar a que baje.', false, 'Beber con la vía aérea comprometida puede provocar más atragantamiento.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Un compañero se quema el antebrazo con aceite. ¿Qué es lo primero y durante cuánto tiempo?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Hielo directo sobre la zona hasta que deje de doler.', false, 'El hielo directo puede provocar una lesión por frío sobre la piel dañada.'),
   (v_q, 'Cubrirla con pomada o aceite para aislarla del aire.', false, 'Ningún remedio graso: retiene el calor y complica la valoración médica.'),
   (v_q, 'Agua fría del grifo sobre la quemadura durante 20 minutos.', true, 'Correcto. Veinte minutos de verdad: es lo más eficaz y lo que más se acorta por prisa.'),
   (v_q, 'Reventar las ampollas para que no se infecten.', false, 'La ampolla intacta protege. Reventarla abre una puerta a la infección.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Una persona se desploma, no responde y no respira con normalidad. Estás tú y dos compañeros.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Señalo a alguien concreto para que llame al 112 y a otro para traer el desfibrilador, y empiezo las compresiones.', true, 'Correcto. Señalar a una persona concreta evita el bloqueo colectivo de "que llame otro".'),
   (v_q, 'Espero a ver si reacciona por sí solo antes de tocarlo.', false, 'Cada minuto sin compresiones reduce mucho las opciones de supervivencia.'),
   (v_q, 'Le doy agua y lo siento en una silla.', false, 'Nunca dar líquidos a alguien inconsciente.'),
   (v_q, 'No hago compresiones por miedo a romperle una costilla.', false, 'Sin compresiones el desenlace es seguro. Imperfecto es mucho mejor que nada.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Un cliente con alergia empieza a hinchársele los labios y le cuesta respirar tras comer. ¿Qué haces primero?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le doy agua y espero unos minutos a ver si mejora.', false, 'La anafilaxia progresa en minutos. Esperar es lo más peligroso.'),
   (v_q, 'Le doy un antihistamínico del botiquín.', false, 'No se administran medicamentos por cuenta propia, y no es el tratamiento de la anafilaxia.'),
   (v_q, 'Lo llevo al aire libre y lo pongo de pie para que respire mejor.', false, 'Levantarlo de golpe puede provocar una bajada brusca de tensión.'),
   (v_q, 'Llamo al 112 de inmediato y, si lleva autoinyector de adrenalina, ayudo a que se lo ponga en el muslo.', true, 'Correcto. Ante hinchazón o dificultad respiratoria no se valora: se llama.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Un corte profundo en la mano sangra mucho y el paño se empapa. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Quito el paño empapado y pongo uno limpio para ver mejor la herida.', false, 'Retirarlo arrastra el coágulo que se estaba formando y reactiva la hemorragia.'),
   (v_q, 'Pongo otro paño encima sin retirar el primero, sigo presionando y elevo la mano.', true, 'Correcto. La presión mantenida es lo que corta la hemorragia.'),
   (v_q, 'Aplico un torniquete en el antebrazo por precaución.', false, 'El torniquete se reserva a hemorragias masivas que no ceden, y con formación.'),
   (v_q, 'Lavo la herida con agua a chorro para ver la profundidad.', false, 'Con hemorragia activa, primero se cohíbe; explorar puede esperar.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Estás usando el desfibrilador (DESA) por primera vez en tu vida y no tienes ni idea. ¿Es seguro?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí: el aparato da instrucciones habladas y solo descarga si detecta que hace falta.', true, 'Correcto. Está diseñado para que lo use cualquiera. No puedes provocar una descarga indebida.'),
   (v_q, 'No: solo puede usarlo personal sanitario.', false, 'Está pensado precisamente para uso por cualquier persona presente.'),
   (v_q, 'Solo si antes he hecho el curso oficial.', false, 'El curso ayuda mucho, pero no se debe renunciar a usarlo por no tenerlo.'),
   (v_q, 'Sí, pero hay que darle descarga cuanto antes sin escuchar al aparato.', false, 'Hay que seguir sus instrucciones: él decide si procede descargar.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'A un compañero se le clava un trozo de cristal grande en el brazo. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo saco con cuidado y luego presiono la herida.', false, 'El objeto puede estar taponando el vaso; sacarlo puede desencadenar una hemorragia grave.'),
   (v_q, 'Lo saco y desinfecto con alcohol.', false, 'Mismo error, y el alcohol sobre una herida abierta no es adecuado.'),
   (v_q, 'Lo dejo clavado, inmovilizo alrededor sin presionar sobre el objeto y lo llevo al hospital.', true, 'Correcto. Los objetos clavados se retiran en un entorno sanitario.'),
   (v_q, 'Lo muevo un poco para ver si está profundo.', false, 'Moverlo puede aumentar el daño de los tejidos y sangrar más.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Al llamar al 112 en plena emergencia, ¿qué es lo más importante?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Contar rápido lo que pasa y colgar para no ocupar la línea.', false, 'Colgar antes de tiempo te deja sin las indicaciones que pueden salvar a la persona.'),
   (v_q, 'Dar la dirección exacta y qué ha pasado, y NO colgar: van a guiarte hasta que llegue la ayuda.', true, 'Correcto. Ponlo en altavoz y sigue sus instrucciones mientras actúas.'),
   (v_q, 'Llamar primero al jefe para que él decida si se avisa.', false, 'En una urgencia vital no se pide permiso: se llama.'),
   (v_q, 'Buscar el teléfono del centro de salud más cercano.', false, 'El 112 coordina el recurso adecuado; es la vía correcta y única necesaria.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Una compañera embarazada se atraganta y no puede respirar ni toser. ¿Dónde haces las compresiones?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'En el abdomen, igual que a cualquier persona.', false, 'En embarazadas las compresiones abdominales están contraindicadas.'),
   (v_q, 'No se hacen compresiones: solo golpes en la espalda.', false, 'Sí se hacen, pero cambiando su localización.'),
   (v_q, 'En la parte baja del abdomen, con más suavidad.', false, 'No es cuestión de fuerza: la localización abdominal no procede.'),
   (v_q, 'En el centro del pecho, no en el abdomen. Igual que en personas obesas.', true, 'Correcto. Mismo criterio en embarazadas y personas con obesidad importante.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, 'Tras usar el autoinyector de adrenalina, el cliente mejora bastante y dice que ya se encuentra bien. ¿Qué corresponde?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Si está bien, puede seguir con su cena.', false, 'La mejoría inicial no descarta que la reacción vuelva.'),
   (v_q, 'Se le deja marchar a casa avisando de que vaya al médico mañana.', false, 'La valoración debe ser inmediata, no al día siguiente.'),
   (v_q, 'Debe ir al hospital igualmente: la reacción puede reaparecer horas después.', true, 'Correcto. Es la llamada reacción bifásica: obligada observación hospitalaria.'),
   (v_q, 'Solo si vuelve a encontrarse mal en la próxima hora.', false, 'Esperar a que reaparezca es exactamente el riesgo que se quiere evitar.');

  raise notice 'Curso primeros auxilios sembrado (draft, mixto). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.delivery_mode,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='primeros_auxilios' and c.account_id is null;
-- Esperado: draft · mixto · 6 secciones · 10 preguntas · 10 correctas.
