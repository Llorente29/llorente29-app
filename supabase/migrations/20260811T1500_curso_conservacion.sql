-- ============================================================================
-- Folvy · CURSO "Conservación y etiquetado: que dure y que se sepa qué es"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque B (cocina)
-- ----------------------------------------------------------------------------
-- Quinto curso del bloque cocina. Une dos cosas que van juntas: conservar bien
-- (frío, envasado, vida útil) y etiquetar (que cualquiera sepa qué es y de
-- cuándo). Sin etiqueta, la mejor conservación del mundo acaba en la basura.
--
-- TAXONOMÍA: category='cocina' · business_types={todos} · level='base'
--            requires_practical=true (etiquetar y guardar una preparación real)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'.
--
-- Correctas del test: c b a d b c a b d c (verificado)
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
    null, 'conservacion_etiquetado',
    'Conservación y etiquetado: que dure y que se sepa qué es',
    'Cómo se guarda cada cosa para que aguante, cuánto dura de verdad, y por qué un táper sin etiqueta acaba siempre en la basura.',
    'Reglamento (CE) 852/2004, Anexo II · Reg. (UE) 1169/2011 (alérgenos)',
    'folvy_imparte', 24, false, true, 20, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'conservacion_etiquetado' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'cocina', 'base', 240, v_course_id);
  end if;
  if exists (select 1 from information_schema.columns where table_name='course' and column_name='business_types') then
    execute format('update public.course set business_types=%L::text[] where id=%L', '{todos}', v_course_id);
  end if;
  if exists (select 1 from information_schema.columns where table_name='course' and column_name='requires_practical') then
    execute format('update public.course set requires_practical=true where id=%L', v_course_id);
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Un táper sin etiqueta ya está en la basura',
$md$Hay una escena que se repite en todas las cocinas del mundo: alguien abre la cámara, encuentra un táper con algo blanco dentro, lo huele, duda, y lo tira.

Ese producto estaba perfecto. Se ha tirado **porque nadie sabía qué era ni de cuándo**.

Y ese es el resumen del curso: **conservar bien y etiquetar son la misma cosa**. Puedes tener el mejor abatidor y el envasado al vacío más caro, que si el táper no dice qué lleva y de qué día es, acabará en el cubo igual.

**Tres cosas que se juegan aquí:**

- **Dinero.** Lo que se tira por no saber qué era es merma pura y evitable.
- **Seguridad.** Un producto sin fecha puede llevar tres días o diez. Nadie lo sabe, y alguien acabará usándolo.
- **Alérgenos.** Un bote sin etiqueta es un bote del que **ya no se puede informar**. Si un cliente pregunta si esa salsa lleva mostaza, la única respuesta honesta es "no lo sé" — y eso, en hostelería, no es una respuesta aceptable.

**En tu cocina esto pasa así:** nadie deja de etiquetar por dejadez. Se deja de etiquetar **porque hay prisa y porque "esto lo gasto yo mañana"**. Y mañana libras, o entra otro turno, o se te olvida. La etiqueta no es para ti: **es para el que abra esa cámara cuando tú no estés.**

> **Marco legal** — Reg. (CE) 852/2004, Anexo II: los productos alimenticios deben conservarse en condiciones que eviten su deterioro y protegerse de la contaminación. Reg. (UE) 1169/2011: obligación de poder informar de los 14 alérgenos de cada elaboración — imposible si el producto no está identificado.$md$),

  (v_course_id, 2, 'Cómo se etiqueta bien (y cuesta 10 segundos)',
$md$Una etiqueta útil tiene **cuatro datos**. Ni uno más:

1. **Qué es.** "Salsa mil islas", no "salsa".
2. **Fecha de elaboración** o de apertura.
3. **Fecha límite de consumo** — hasta cuándo se puede usar.
4. **Quién lo hizo**, o el turno. Sirve para preguntar si hay dudas.

**Qué se etiqueta:**
- **Todo lo que preparas**: salsas, marinados, cortes, mise en place.
- **Todo lo que sacas de su envase original**. Ese es el momento en que se pierde la información: la lista de ingredientes, los alérgenos y la caducidad estaban en el envase que acabas de tirar.
- **Todo lo que abres**, aunque siga en su bote: una vez abierto, la caducidad impresa ya no vale.
- **Y lo que descongelas**, con la fecha en que se descongeló.

**El error clásico**: trasvasar salsas a biberones sin identificar. Tres días después nadie sabe cuál de los dos amarillos lleva mostaza — y ese día viene un alérgico.

**En tu cocina esto pasa así:** cuando las etiquetas están a mano y son fáciles de rellenar, se usan. Cuando hay que buscar el rotulador y el papel está lejos, no. **Si en tu cocina no se etiqueta, mira primero dónde está el material**: casi siempre el problema es ese, no las ganas.

> **Datos técnicos** — La identificación debe permitir conocer el contenido, su fecha y su vida útil sin abrir el envase. Un producto trasvasado sin etiqueta pierde la trazabilidad y la información de alérgenos del envase original.$md$),

  (v_course_id, 3, '¿Cuánto dura de verdad?',
$md$La vida útil no es una intuición: la fija cada empresa según el producto y el proceso, y viene en la ficha o en el plan de la cocina. Pero hay principios que ayudan a entender el porqué.

**Cuanto más manipulado, menos dura.** Una pieza entera de carne aguanta más que la misma picada, porque al picarla multiplicas la superficie expuesta y le metes las bacterias de fuera hacia dentro.

**Cuanto más húmedo y menos ácido, menos dura.** Por eso un escabeche aguanta y una crema no.

**Lo cocinado y enfriado tiene su propio reloj**, que empieza al enfriar. Y **lo descongelado dura menos** que lo fresco: al descongelarse, la célula se rompe y suelta agua.

**Referencias habituales en cocina** (siempre por debajo de lo que diga tu ficha, y **siempre en refrigeración correcta**):
- Elaboraciones cocinadas y enfriadas: **2-3 días** normalmente, hasta 5 según producto y proceso.
- Producto crudo porcionado: **el mismo día o el siguiente**.
- Salsas frías con huevo pasteurizado: según ficha, **cortas**.
- Producto envasado al vacío: aguanta más, **pero no es magia** — si se envasó con carga bacteriana alta, dura poco igual.

**🔴 Y una regla que no se negocia: la fecha manda sobre el aspecto.** Si algo tiene buen aspecto y buen olor pero se pasó de fecha, **se tira**. Los patógenos peligrosos no cambian el sabor, el color ni el olor. Un producto contaminado con salmonela huele perfectamente bien.

**En tu cocina esto pasa así:** el "esto todavía está bien" es la frase que precede a casi todas las intoxicaciones. Se dice con toda la buena intención del mundo — y sin ninguna información real detrás.

> **Datos técnicos** — La vida útil la establece el operador conforme a su sistema de autocontrol, considerando el producto, el proceso y las condiciones de conservación. Los patógenos que causan toxiinfección no producen alteraciones organolépticas detectables.$md$),

  (v_course_id, 4, 'Envasar bien: aire, humedad y frío',
$md$Tres enemigos, y cada envase sirve para uno:

**El aire** oxida y seca. Por eso se tapa todo. El **vacío** quita el aire y alarga la vida... **pero cuidado**: al quitar el oxígeno, favorece a las bacterias que crecen sin él. El vacío **no sustituye al frío**, lo complementa.

**La humedad** ablanda lo crujiente y pudre lo delicado. Los fritos y rebozados necesitan aire, no hermetismo. Lo que suda hay que dejarlo respirar o enfriarlo antes de tapar.

**El calor residual** es el error más común. **Nunca tapes y metas a cámara algo que aún está caliente**: por dos motivos. Primero, sube la temperatura de toda la cámara y pone en riesgo lo demás. Segundo, el vapor queda atrapado, condensa y crea el ambiente perfecto para que crezca todo.

**Cómo se hace bien:**
- **Enfría rápido antes de tapar**: en recipientes bajos y anchos, o en abatidor. De 65 °C a 10 °C en menos de dos horas.
- **Recipientes limpios y del tamaño adecuado.** Mucho aire sobrante seca el producto.
- **Nunca en la lata abierta**: las conservas se pasan a otro recipiente en cuanto se abren. El metal en contacto con el aire puede transferir sabor y no está pensado para conservar una vez abierto.
- **Tapa siempre**, aunque sea con film. Lo destapado se contamina y también contamina lo de abajo.

**En tu cocina esto pasa así:** la olla caliente que se mete a cámara "tapada para que no coja olores" es el gesto que más problemas causa: rompe la temperatura de toda la cámara, tarda horas en enfriarse por dentro, y ese producto pasa media noche en zona de peligro.

> **Datos técnicos** — Enfriamiento rápido: de 65 °C a 10 °C en menos de 2 horas. El envasado al vacío reduce el oxígeno pero favorece a los microorganismos anaerobios: exige mantener la cadena de frío estrictamente y no alarga la vida útil por sí solo.$md$),

  (v_course_id, 5, 'Dónde va cada cosa',
$md$La colocación no es cuestión de espacio: es una barrera de seguridad.

**En la cámara, de arriba abajo:**
1. **Listo para consumo** — postres, quesos, salsas frías.
2. **Cocinado** — tapado y con fecha.
3. **Verduras y fruta.**
4. **Carne y pescado crudos** — siempre abajo del todo.

El motivo es de gravedad: **los jugos caen**. Si el crudo está arriba, gotea sobre lo que ya está listo para servir.

**Otras reglas:**
- **Nada en el suelo**, ni en cámara ni en almacén.
- **Separación de alérgenos**: lo "sin gluten" y los productos para alérgicos, arriba y aislados. La harina cae.
- **Químicos de limpieza siempre aparte**, nunca en la misma zona que alimentos.
- **No sobrecargues la cámara**: el aire tiene que circular. Una cámara llena hasta arriba no enfría bien aunque el termostato marque lo correcto.
- **FIFO/FEFO al colocar**: lo nuevo detrás.

**En el congelador**, además: envasado bien cerrado (la quemadura por frío es aire en contacto con el producto) y **con fecha de congelación**. Y lo descongelado **no se vuelve a congelar**.

**En tu cocina esto pasa así:** la cámara se ordena bien el día que se limpia y se desordena en tres servicios. Por eso la colocación correcta tiene que ser **el gesto por defecto al guardar**, no una tarea aparte que alguien hace los lunes.

> **Datos técnicos** — Reg. (CE) 852/2004, Anexo II Cap. IX: protección frente a la contaminación cruzada durante el almacenamiento. La circulación de aire es condición para que un equipo de frío alcance la temperatura de consigna en todo su volumen.$md$),

  (v_course_id, 6, 'Qué se espera de ti',
$md$Cinco cosas, y ninguna lleva más de unos segundos:

**1. Etiqueta todo lo que prepares, abras o trasvases.** Qué es, cuándo se hizo, hasta cuándo vale, quién lo hizo.

**2. Enfría antes de tapar y meter a cámara.** Rápido, en recipientes bajos.

**3. Respeta la fecha, no el aspecto.** Lo caducado se tira aunque parezca perfecto.

**4. Coloca crudo abajo, listo arriba**, y lo nuevo detrás.

**5. Si encuentras algo sin identificar, no lo uses.** Y dilo, para saber de dónde salió.

**Y una cosa más, que es la que de verdad cambia una cocina:** cuando encuentres un táper sin etiqueta, **no te limites a tirarlo**. Comenta que ha pasado. Si ocurre a menudo, algo falla en el sistema — casi siempre que el material de etiquetado no está a mano donde se prepara.

**La idea que resume el curso:**

> La etiqueta no es para ti. Es para quien abra esa cámara cuando tú no estés.

**Antes de terminar**: abre tu cámara y mira cuántas cosas hay sin etiquetar. Ese número es el dinero que vas a tirar esta semana.

> **Datos técnicos** — Identificación, fecha y vida útil son parte del plan de trazabilidad y del control de alérgenos del sistema de autocontrol. Un producto no identificado no puede declararse ante un cliente ni justificarse ante una inspección.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: c b a d b c a b d c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Acabas de hacer una olla de guiso y hay que guardarla. Aún está caliente.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'La tapo y la meto a cámara para que se enfríe antes.', false, 'Sube la temperatura de toda la cámara y el vapor queda atrapado.'),
   (v_q, 'La dejo destapada en la encimera hasta que se temple.', false, 'Pasa horas en zona de peligro y se contamina al estar destapada.'),
   (v_q, 'La reparto en recipientes bajos para que enfríe rápido, y la tapo y etiqueto cuando esté fría.', true, 'Correcto. De 65 °C a 10 °C en menos de 2 horas, y tapar solo cuando ya no suelta vapor.'),
   (v_q, 'La tapo con film y la dejo fuera toda la noche.', false, 'Toda la noche en zona de peligro: es el peor escenario.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Trasvasas una salsa del bote original a un biberón para el pase. ¿Hay que etiquetarlo?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No, si se gasta en el mismo servicio.', false, 'Casi nunca se gasta del todo, y entonces queda sin identificar.'),
   (v_q, 'Sí: al salir del envase original se pierde la información de alérgenos y la caducidad.', true, 'Correcto. Sin etiqueta, ya no se puede informar de lo que lleva.'),
   (v_q, 'Solo si es una salsa con alérgenos.', false, 'No siempre sabes cuáles llevan: por eso se etiquetan todas.'),
   (v_q, 'Basta con recordar cuál es.', false, 'La etiqueta no es para ti: es para quien entre en el siguiente turno.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Un producto pasó ayer su fecha límite, pero huele y tiene un aspecto perfecto.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Se tira: la fecha manda sobre el aspecto.', true, 'Correcto. Los patógenos peligrosos no cambian olor, color ni sabor.'),
   (v_q, 'Se usa: si estuviera mal, se notaría.', false, 'Un producto con salmonela huele perfectamente bien.'),
   (v_q, 'Se usa cocinándolo bien.', false, 'El calor no elimina las toxinas ya producidas.'),
   (v_q, 'Se usa para la comida del personal.', false, 'La seguridad es la misma para el equipo que para el cliente.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Abres una lata grande de conserva y sobra la mitad.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'La tapo con film y la guardo en la propia lata.', false, 'La lata abierta no está pensada para conservar: puede transferir sabor.'),
   (v_q, 'La guardo en la lata, que es su envase original.', false, 'Deja de serlo en cuanto se abre.'),
   (v_q, 'La dejo en la lata pero la gasto el mismo día.', false, 'Aunque se gaste rápido, el envase abierto no es adecuado.'),
   (v_q, 'La paso a otro recipiente, lo tapo y lo etiqueto con la fecha de apertura.', true, 'Correcto. Y la caducidad impresa deja de valer al abrir.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'En la cámara, ¿dónde va la carne cruda?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Arriba, que es donde mejor enfría.', false, 'Los jugos caerían sobre todo lo demás.'),
   (v_q, 'Abajo del todo, porque los jugos caen y no deben gotear sobre lo cocinado.', true, 'Correcto. Es una barrera de seguridad, no una cuestión de espacio.'),
   (v_q, 'Donde quepa, si va bien tapada.', false, 'El film se mueve y gotea al sacarlo. La colocación es la barrera.'),
   (v_q, 'En la balda del medio, separada de la verdura.', false, 'Sigue habiendo producto debajo al que puede gotear.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, '¿Qué hace exactamente el envasado al vacío?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Esteriliza el producto.', false, 'No mata nada: solo quita el oxígeno.'),
   (v_q, 'Permite conservar fuera de frío.', false, 'Peligroso: el vacío NO sustituye a la cadena de frío.'),
   (v_q, 'Quita el oxígeno y alarga la vida útil, pero favorece a las bacterias que crecen sin aire: exige frío estricto igualmente.', true, 'Correcto. Complementa al frío, no lo reemplaza.'),
   (v_q, 'Alarga la vida útil indefinidamente.', false, 'Si se envasó con carga bacteriana alta, dura poco igual.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Encuentras en la cámara un táper con algo sin identificar. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No lo uso, lo desecho registrándolo como merma, y comento que ha pasado.', true, 'Correcto. Y si ocurre a menudo, suele ser que el material de etiquetar no está a mano.'),
   (v_q, 'Lo huelo y, si está bien, lo uso.', false, 'No sabes qué es, de cuándo es ni qué alérgenos lleva.'),
   (v_q, 'Lo dejo donde está por si alguien lo reclama.', false, 'Seguirá ahí una semana más y acabará igual en la basura.'),
   (v_q, 'Le pongo la fecha de hoy y lo dejo.', false, 'Estarías inventando un dato: no sabes de cuándo es.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'La cámara está llena hasta arriba pero el termostato marca 3 °C.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Todo correcto: el termostato indica la temperatura real.', false, 'Marca la del sensor, no la de todos los puntos de la cámara.'),
   (v_q, 'Hay un problema: sin circulación de aire, no todo el producto está a esa temperatura.', true, 'Correcto. Una cámara sobrecargada no enfría bien aunque el termostato diga lo contrario.'),
   (v_q, 'Basta con bajar el termostato un par de grados.', false, 'No resuelve la falta de circulación de aire.'),
   (v_q, 'No importa mientras la puerta se abra poco.', false, 'El problema es interno, no de aperturas.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Descongelas una pieza y al final no se usa. ¿Se puede volver a congelar?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí, si se congela rápido otra vez.', false, 'La velocidad no elimina el problema.'),
   (v_q, 'Sí, si no ha estado más de unas horas fuera.', false, 'Igualmente no debe recongelarse.'),
   (v_q, 'Sí, si se cocina antes de congelar de nuevo.', false, 'Cocinar cambia el producto, pero eso es otra elaboración: no es "volver a congelar lo mismo".'),
   (v_q, 'No: lo descongelado no se vuelve a congelar. Se usa en su plazo o se desecha registrándolo.', true, 'Correcto. Al descongelarse la célula se rompe y el producto se degrada mucho más rápido.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿Qué cuatro datos debe llevar una etiqueta?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Producto, peso, precio y proveedor.', false, 'Peso y precio no ayudan a decidir si se puede usar.'),
   (v_q, 'Solo la fecha: lo demás se ve.', false, 'No se ve: por eso se tiran táperes con producto en buen estado.'),
   (v_q, 'Qué es, fecha de elaboración o apertura, fecha límite de consumo y quién lo hizo.', true, 'Correcto. Cuatro datos, diez segundos.'),
   (v_q, 'Qué es y los alérgenos que lleva.', false, 'Falta lo esencial: las fechas. Sin ellas no se sabe si sirve.');

  raise notice 'Curso de conservación y etiquetado sembrado (draft, cocina). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.category,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='conservacion_etiquetado' and c.account_id is null;
-- Esperado: draft · cocina · 6 secciones · 10 preguntas · 10 correctas.
