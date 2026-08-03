-- ============================================================================
-- Folvy · CURSO "Higiene alimentaria — manipulador de alimentos"
-- REESCRITURA DIDÁCTICA (molde de docs/folvy_formacion_guia_contenido.md)
-- ----------------------------------------------------------------------------
-- Este fichero REEMPLAZA el contenido sembrado por 20260807T1700 (que era
-- esquemático). Mismo `code`, mismo id de curso: no rompe asignaciones.
--
-- CURSO DE REFERENCIA del catálogo: es el molde que siguen los demás.
--   · Cada sección: título llano → el porqué → imagen → "en tu cocina" → recuadro técnico
--   · Test SITUACIONAL (qué harías), no de definiciones
--   · Posición de las correctas variada (verificado): c b a d b c a d b c
--
-- MARCO LEGAL: RD 109/2010 (la empresa forma y certifica; no hay carnet
-- oficial ni centros homologados desde 2011) · Reg. (CE) 852/2004 Anexo II
-- Cap. XII · Reg. (CE) 2073/2005 · Reg. (UE) 1169/2011 (alérgenos, curso aparte).
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — se mantiene en status 'draft'.
--    Contenido redactado por Claude desde la normativa (no de un dosier
--    revisado). El certificado lo firma el responsable de formación de la
--    EMPRESA cliente: debe estar validado antes de publicarse.
--    Para publicar tras revisión:
--      update course set status='published'
--       where code='manipulador_alimentos' and account_id is null;
--
-- IMÁGENES: las secciones quedan con media_url NULL. Los esquemas SVG viven en
--    public/formacion/ y se asignan en un paso posterior (ver §imagen sugerida
--    en cada sección).
--
-- DEPENDE DE: 20260806T1500_formacion_c1.sql
-- IDEMPOTENTE: regenera el contenido sin cambiar el id del curso.
-- Aplicada:
-- ============================================================================

do $guard$
begin
  if to_regclass('public.course') is null or to_regclass('public.course_section') is null
     or to_regclass('public.course_question') is null or to_regclass('public.course_option') is null then
    raise exception 'Faltan tablas de Formación C1. Aplica primero la migración de estructura.';
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
    null, 'manipulador_alimentos',
    'Higiene alimentaria — manipulador de alimentos',
    'Lo que tienes que saber y hacer para que nadie enferme por la comida que sale de tu cocina: higiene personal, temperaturas, contaminación cruzada, limpieza, plagas y trazabilidad.',
    'RD 109/2010 · Reglamento (CE) 852/2004, Anexo II Cap. XII',
    'folvy_imparte', 48, true, true, 30, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'manipulador_alimentos' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Por qué esto va contigo',
$md$Si tocas alimentos, eres manipulador. Da igual que cocines, emplates, recibas el pedido del proveedor o lleves la bolsa al repartidor.

Antes existía el famoso "carnet de manipulador" que se sacaba fuera. Ya no. Desde 2010 la ley dice que **es la empresa la que forma a su gente y lo acredita**. Por eso estás haciendo este curso aquí: tu firma al final es la acreditación.

Lo que está en juego no es una multa. Una intoxicación alimentaria puede mandar a alguien al hospital, cerrar el local y acabar en un juicio. Y casi siempre ocurre por tres cosas que se pueden evitar: **temperaturas mal llevadas, manos mal lavadas y crudo que toca cocinado**.

Lo que puede hacer daño a un cliente cabe en tres grupos:
- **Bichos que no ves**: bacterias como la salmonela o la listeria, virus, parásitos, mohos. Son la causa más frecuente, y no huelen ni se ven.
- **Productos químicos**: restos de desinfectante mal aclarado, un producto de limpieza guardado cerca de la comida.
- **Cosas duras**: un trozo de cristal, un plástico, un pelo, un anillo, una tirita.

**En tu cocina esto pasa así:** un plato que huele bien, tiene buen color y está recién hecho puede estar contaminado igualmente. **No puedes fiarte de tus sentidos.** Por eso trabajamos con normas y no con "a mí me parece que está bien".

> **Marco legal** — RD 109/2010: se suprime el carnet oficial y la homologación de centros; la responsabilidad de la formación recae en la empresa alimentaria, que puede impartirla y emitir certificado propio. Reglamento (CE) 852/2004, Anexo II, Cap. XII: formación adecuada al puesto de trabajo.$md$),

  (v_course_id, 2, 'Las bacterias tienen su temperatura favorita',
$md$Las bacterias son seres vivos y les pasa como a nosotros: si están a gusto, comen y se reproducen. Si pasan frío, se quedan quietas. Si pasan mucho calor, mueren.

Su temperatura favorita va **de 5 °C a 65 °C**. Ahí, en pocas horas, unas pocas se convierten en millones. A esa franja la llamamos **zona de peligro**.

Por eso un alimento solo está seguro en dos sitios: **muy frío** (nevera, por debajo de 5 °C, donde se quedan dormidas) o **muy caliente** (por encima de 65 °C, donde mueren). Lo peligroso es el término medio.

Y ojo con una trampa: lo que cuenta es la temperatura **en el centro** del producto, no en la superficie. Una hamburguesa puede estar negra por fuera y cruda por dentro.

**En tu cocina esto pasa así:** sacas una bandeja de guiso y la dejas en la encimera "para que se temple" antes de meterla a cámara. Tres horas después está a 30 °C, justo en mitad de la zona roja, y nadie nota nada raro. Por eso el enfriado se hace **rápido**: reparte en recipientes bajos y anchos, o usa el abatidor. Cuanto menos altura, antes baja.

Dos reglas más que se saltan a menudo:
- **Descongelar siempre en la nevera**, en un recipiente que recoja el líquido. Nunca en la encimera ni con agua caliente: la superficie entra en zona de peligro mientras el centro sigue helado.
- **Recalentar una sola vez**, y hasta que queme de verdad. Lo que se recalienta dos veces se tira.

> **Datos técnicos** — Zona de peligro: 5–65 °C. Refrigeración 0–4 °C. Congelación ≤ −18 °C. Cocinado ≥ 65 °C en el centro (≥ 70–75 °C en carne picada, aves y elaboraciones con huevo). Mantenimiento en caliente ≥ 65 °C, en frío ≤ 4 °C. Enfriamiento rápido: de 65 °C a 10 °C en menos de 2 horas. Pescado para consumo crudo, marinado o poco cocinado: congelación a −20 °C durante al menos 5 días (anisakis). Elaboraciones con huevo que no alcancen 70 °C: ovoproducto pasteurizado obligatorio.$md$),

  (v_course_id, 3, 'Tus manos son la herramienta que más contamina',
$md$El lavado de manos es la medida que más intoxicaciones evita. Más que cualquier desinfectante caro.

No vale mojárselas. Es **agua caliente, jabón y 20 segundos frotando**: palmas, dorso, entre los dedos, uñas y muñecas. Y secado con papel de un solo uso — un trapo compartido devuelve a tus manos lo que acabas de quitar.

**Lávatelas siempre**: al empezar el turno, al volver a cocina, después del baño, de fumar, de comer, de sonarte, de tocar basura, cajas, dinero o el móvil. Y **cada vez que pases de un alimento crudo a uno que ya está listo para comer**.

Sobre los guantes hay un malentendido peligroso: **no sustituyen al lavado de manos**. Un guante sucio contamina exactamente igual que una mano sucia. Se cambian al cambiar de tarea.

Y hay cosas que sobran en cocina: anillos, reloj, pulseras y pendientes colgantes (retienen suciedad y pueden caer al plato), uñas largas, esmalte o uñas postizas. El pelo, recogido del todo. Las heridas, tapadas con apósito impermeable **de color llamativo** — azul, porque no hay comida azul: si cae, se ve.

**En tu cocina esto pasa así:** deshuesas un pollo crudo, te suena el teléfono, lo coges, y sigues emplatando una ensalada. Acabas de llevar la salmonela del pollo al plato de un cliente pasando por tu móvil. Ese es el camino real, no uno teórico.

**🔴 Y una obligación que no es opcional:** si tienes **vómitos, diarrea, fiebre, ictericia o una infección de garganta, piel u oídos**, díselo a tu responsable **antes de empezar el turno**. Puedes estar contagiando sin sentirte mal del todo. No es quedar mal con el equipo: es la ley y es proteger a gente que no conoces.

> **Datos técnicos** — Reg. (CE) 852/2004, Anexo II, Cap. VIII: obligación de mantener un elevado grado de aseo personal y de que las personas que padezcan o sean portadoras de una enfermedad transmisible por los alimentos no manipulen alimentos. Lavado eficaz: ≥ 20 segundos con agua y jabón, secado con papel de un solo uso.$md$),

  (v_course_id, 4, 'Lo crudo, abajo; lo listo, arriba',
$md$La **contaminación cruzada** es que un peligro pase de un sitio a otro: de un alimento crudo a uno cocinado, de una tabla a otra, de tu mano a un plato. Es la causa más habitual de intoxicación en hostelería, y casi siempre es un descuido, no una mala intención.

Se corta por tres sitios:

**Separa lo crudo de lo listo.** Tablas y cuchillos distintos (si hay sistema de colores, úsalo). Y nunca pongas un alimento cocinado en el recipiente donde estaba el crudo sin lavarlo antes.

**Coloca bien la cámara.** Lo cocinado y lo listo para comer, **arriba**. Lo crudo, **abajo del todo**. El motivo es de sentido común: los jugos caen hacia abajo. Si el pollo crudo está arriba, gotea sobre lo que ya está listo para servir.

**Ordena el almacén.** Nada en el suelo. Todo tapado, etiquetado y con fecha. Rotación **FIFO/FEFO**: lo primero que entra o lo primero que caduca, es lo primero que sale. Los productos de limpieza, siempre en zona aparte — nunca junto a alimentos.

Y presta atención a las fechas, porque no son lo mismo: **"consumo preferente"** significa que pierde calidad; **"fecha de caducidad"** es un límite de seguridad, y pasada esa fecha el producto se tira.

**En tu cocina esto pasa así:** llega el reparto en plena hora punta, no hay sitio en la cámara y alguien mete la bandeja de pollo crudo en el primer hueco libre, que está en la balda de arriba. Debajo hay una bandeja de ensaladilla ya montada. Nadie ha hecho nada "malo" y sin embargo acabas de crear el riesgo más serio del día.

> **Datos técnicos** — Reg. (CE) 852/2004, Anexo II, Cap. IX: protección de los productos alimenticios frente a cualquier contaminación que pueda hacerlos no aptos para el consumo. Orden en cámara de arriba abajo: listos para consumo → cocinados → verduras y fruta → carne y pescado crudos. Cadena de frío rota en recepción: se rechaza el producto y se registra.$md$),

  (v_course_id, 5, 'Limpiar no es desinfectar (y las plagas se previenen)',
$md$Son dos cosas distintas y hacen falta las dos. **Limpiar** quita la suciedad que ves. **Desinfectar** mata los microorganismos que no ves. Desinfectar sobre suciedad no sirve de nada: el producto se gasta en la grasa y no llega a los bichos.

El orden correcto: retirar restos → limpiar con detergente → aclarar → desinfectar → aclarar si el producto lo pide → secar.

Respeta **la dosis y el tiempo de contacto** que dice la etiqueta. Los dos errores clásicos: echar de menos (no desinfecta, solo huele a limpio) y echar de más (deja residuo químico en la superficie donde luego pones comida). Y los productos, siempre **en su envase original y etiquetados**: nunca en una botella de agua.

Bayetas y estropajos son de los sitios más sucios de una cocina — mejor papel de un solo uso. Y la basura, en cubos con tapa y apertura de pedal; después de tocarla, manos.

**Las plagas se combaten antes de que lleguen**, no con veneno una vez están: puertas y ventanas protegidas, sin huecos ni grietas, y nada de comida ni restos accesibles por la noche.

**En tu cocina esto pasa así:** ves excrementos pequeños detrás de unas cajas del almacén. La tentación es limpiarlo, no decir nada y comprar veneno en el súper. Es el peor movimiento posible: ocultas una plaga que va a más, y metes un producto químico peligroso donde hay comida. Lo correcto es avisar **hoy** — el tratamiento lo hace personal autorizado.

Y una parte de tu trabajo que a veces se ve como papeleo: **los registros del APPCC** (temperaturas, recepciones, limpieza). Rellenarlos a tiempo y con datos reales es lo que demuestra que todo esto se hace. Un registro rellenado a boli el día antes de la inspección es peor que no tenerlo: es falso.

> **Datos técnicos** — Reg. (CE) 852/2004, Anexo II, Cap. I y II (locales), Cap. VI (residuos): los establecimientos deben disponer de un plan de limpieza y desinfección y de un plan de control de plagas dentro del sistema de autocontrol basado en los principios del APPCC. Productos de limpieza: almacenados separados de los alimentos, en envase original.$md$),

  (v_course_id, 6, 'Poder demostrar de dónde viene cada cosa',
$md$**Trazabilidad** suena a palabra de oficina, pero significa algo muy concreto: poder saber de dónde vino cada producto y adónde fue.

Se sostiene en cosas que ya pasan por tus manos: los albaranes, las etiquetas y los números de lote. Por eso **no se tira la etiqueta con el lote hasta que el producto se ha consumido**, y por eso, cuando trasvasas algo a otro recipiente, hay que etiquetarlo con lo que es y su fecha.

¿Para qué sirve de verdad? Imagina que salta una alerta sanitaria por un lote concreto de un queso. Si tienes la trazabilidad, retiras exactamente ese lote en cinco minutos. Si no la tienes, tienes que tirar todo el queso del local y no puedes demostrar nada.

**Los alérgenos** merecen mención aparte (tienen su propio curso, y es obligatorio además de este): hay 14 de declaración obligatoria y el local debe poder informar de ellos plato a plato. Si un cliente pregunta y no estás seguro, **consulta la ficha o pregunta a cocina. Nunca improvises un "creo que no lleva"**: ese "creo" puede acabar en una ambulancia.

**Cuando algo va mal, esto es lo que se hace:**
- Producto sospechoso (olor raro, envase hinchado o roto, llegó caliente) → **no lo uses, sepáralo, identifícalo y avisa**.
- Un cliente dice que se ha encontrado mal → avisa de inmediato y **guarda las muestras y los registros**. No tires nada: es lo que te va a defender.
- Se rompe un cristal en zona de manipulación → se retira todo el alimento del área. No se rescata nada.

**La regla de oro, y con esta te quedas:** ante la duda, no lo sirvas y pregunta. Un plato tirado cuesta unos euros. Una intoxicación puede costar el negocio.

> **Datos técnicos** — Reglamento (CE) 178/2002, art. 18: obligación de trazabilidad en todas las etapas de la producción, transformación y distribución. Reg. (UE) 1169/2011: información obligatoria sobre los 14 alérgenos. Conservación de registros y documentación del sistema de autocontrol a disposición de la autoridad competente.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c b a d b c a d b c (verificado, posición variada)

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Sacas una olla de guiso caliente y vas a guardarla. Son las 16:00 y hay poco lío. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'La dejo en la encimera hasta que se enfríe sola y luego la meto a cámara.', false, 'Pasaría horas en la zona de peligro (5–65 °C). Es el error más común y el más grave.'),
   (v_q, 'La meto a cámara tal cual, hirviendo, para que no pierda tiempo fuera.', false, 'Subiría la temperatura de toda la cámara y pondría en riesgo lo demás.'),
   (v_q, 'La reparto en recipientes bajos y anchos para que baje rápido, o uso el abatidor.', true, 'Correcto. Hay que cruzar la zona de peligro deprisa: de 65 °C a 10 °C en menos de 2 horas.'),
   (v_q, 'La dejo fuera toda la noche tapada, que tapada no se contamina.', false, 'Tapar no baja la temperatura. Estaría toda la noche en zona de peligro.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Estás deshuesando pollo crudo, suena tu teléfono y lo coges. Al colgar tienes que emplatar una ensalada. ¿Qué haces primero?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Me limpio las manos en el delantal y sigo, que voy con el tiempo justo.', false, 'El delantal no limpia: reparte. Y el pollo crudo puede llevar salmonela.'),
   (v_q, 'Me lavo las manos con agua y jabón 20 segundos y las seco con papel.', true, 'Correcto. Cambio de crudo a listo para consumo: lavado obligatorio. Y el móvil también contamina.'),
   (v_q, 'Me pongo guantes encima, sin lavarme.', false, 'El guante sobre una mano sucia no aísla nada: lo que estaba en la mano pasa al guante y al plato.'),
   (v_q, 'Me enjuago solo con agua fría, que es rápido.', false, 'Sin jabón y sin frotar 20 segundos no se arrastra la grasa donde van las bacterias.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Llega el reparto en hora punta. La cámara está llena y el único hueco libre está en la balda de arriba, justo encima de una ensaladilla ya montada. Traes pollo crudo.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Hago sitio abajo aunque tarde un poco: el crudo va siempre en la balda inferior.', true, 'Correcto. Los jugos del crudo caen; encima de un producto listo para consumo es el peor sitio posible.'),
   (v_q, 'Lo pongo arriba pero bien tapado con film, así no gotea.', false, 'El film se mueve, se rasga y gotea al sacarlo. La colocación es la barrera, no el film.'),
   (v_q, 'Lo dejo fuera hasta que haya hueco abajo.', false, 'Romper la cadena de frío del pollo crudo es otro riesgo grave.'),
   (v_q, 'Lo pongo arriba: total, la ensaladilla va a ir al horno.', false, 'La ensaladilla no se cocina. Y aunque se cocinara, no es forma de trabajar.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Anoche tuviste vómitos y diarrea. Hoy te encuentras algo mejor y entras a turno. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No digo nada: ya estoy mejor y no quiero dejar tirado al equipo.', false, 'Puedes seguir excretando el patógeno aunque te encuentres bien. Es como empiezan los brotes.'),
   (v_q, 'Trabajo con mascarilla y guantes todo el turno.', false, 'No evita la excreción por vía digestiva. No es la medida adecuada.'),
   (v_q, 'Me lavo las manos el doble de veces y ya está.', false, 'Reduce el riesgo pero no lo elimina, y la decisión no es tuya: es del responsable.'),
   (v_q, 'Se lo digo a mi responsable antes de empezar, para que decida si puedo manipular alimentos.', true, 'Correcto. Comunicarlo es una obligación legal del manipulador, no una cortesía.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Vas a montar la salsa de la casa, que lleva huevo y no se cocina. ¿Con qué la haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Con huevo fresco, lavando bien la cáscara antes.', false, 'Lavar la cáscara no elimina la salmonela y puede empujarla al interior por los poros.'),
   (v_q, 'Con ovoproducto pasteurizado.', true, 'Correcto. Obligatorio en elaboraciones con huevo que no alcancen los 70 °C.'),
   (v_q, 'Con huevo fresco, pero gastándola toda hoy.', false, 'El riesgo existe desde el primer minuto, no depende de las horas que aguante.'),
   (v_q, 'Con huevo fresco si lo guardo en frío.', false, 'El frío frena la multiplicación, no elimina el patógeno.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Un cliente con alergia pregunta si una salsa lleva frutos secos. Tú no la has hecho y no estás seguro. Hay cola en la barra.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le digo que no lleva, que la mayoría de nuestras salsas no llevan.', false, 'Una suposición aquí puede provocar una anafilaxia. Nunca se responde "de memoria".'),
   (v_q, 'Le digo que creo que no, pero que decida él bajo su responsabilidad.', false, 'La responsabilidad de informar es del establecimiento; no se traslada al cliente.'),
   (v_q, 'Consulto la ficha del plato o pregunto a cocina antes de responder, aunque tarde un minuto.', true, 'Correcto. Ante la duda, siempre verificar. El minuto de espera no le pasa nada a nadie.'),
   (v_q, 'Le recomiendo otro plato distinto para no complicarme.', false, 'Esquivar no es informar: el cliente tiene derecho a saber lo que lleva cada plato.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Ordenando el almacén ves excrementos pequeños detrás de unas cajas. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Aviso a mi responsable hoy mismo y no aplico ningún producto por mi cuenta.', true, 'Correcto. Tú detectas y avisas; el tratamiento lo hace personal autorizado.'),
   (v_q, 'Lo limpio y no digo nada para no alarmar.', false, 'Ocultar un indicio de plaga la deja crecer, y es una infracción grave.'),
   (v_q, 'Compro veneno y lo coloco yo detrás de las cajas.', false, 'Meterías un peligro químico en una zona con alimentos. Nunca.'),
   (v_q, 'Espero unos días a ver si vuelve a aparecer.', false, 'Cada día de retraso multiplica la plaga y el riesgo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Abres una caja de producto, sacas lo que necesitas y vas a tirar la caja con la etiqueta del lote. ¿Es correcto?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, la etiqueta ya no sirve una vez abierto el producto.', false, 'Sí sirve: es lo que permite identificar el lote ante una alerta.'),
   (v_q, 'Sí, mientras recuerde de qué proveedor era.', false, 'La memoria no es trazabilidad. Hace falta el dato escrito.'),
   (v_q, 'Da igual, eso lo lleva administración con las facturas.', false, 'La factura no dice qué lote concreto se usó en la cocina.'),
   (v_q, 'No: hay que conservar la referencia del lote mientras dure el producto, y etiquetar lo que trasvase.', true, 'Correcto. Sin lote no hay trazabilidad, y ante una alerta habría que retirar todo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Acabas de fregar la plancha con detergente. Vas a desinfectar y ves que queda poco producto. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Echo la mitad de dosis, algo desinfectará.', false, 'Por debajo de la dosis no desinfecta: da sensación de limpio sin serlo.'),
   (v_q, 'Aviso y consigo producto para hacerlo con la dosis y el tiempo que indica la etiqueta.', true, 'Correcto. Dosis y tiempo de contacto son lo que hace efectiva la desinfección.'),
   (v_q, 'Echo el doble del resto para compensar y no aclaro.', false, 'Pasarse deja residuo químico justo donde se apoya la comida.'),
   (v_q, 'Lo dejo, que con el detergente ya ha quedado limpio.', false, 'Limpiar quita la suciedad visible; no mata los microorganismos.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, 'Sacas del congelador una pieza de carne para mañana. ¿Dónde la descongelas?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'En la encimera, tapada, que así va más rápido.', false, 'La superficie entra en zona de peligro mientras el centro sigue congelado.'),
   (v_q, 'Bajo el grifo de agua caliente.', false, 'Es la forma más rápida de multiplicar bacterias en la superficie.'),
   (v_q, 'En la nevera, en un recipiente que recoja el líquido y en la balda de abajo.', true, 'Correcto. Lento, seguro y sin gotear sobre otros alimentos.'),
   (v_q, 'Cerca del horno, que hay buena temperatura.', false, 'La peor opción: calor suave es exactamente la zona de peligro.');

  raise notice 'Curso manipulador reescrito (didáctico). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (ejecutar POR SEPARADO) ───────────────────────────────────
-- select c.code, c.status, c.version,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='manipulador_alimentos' and c.account_id is null;
-- Esperado: draft · 6 secciones · 10 preguntas · 10 correctas.
