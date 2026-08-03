-- ============================================================================
-- Folvy · CURSO "Gestión de alérgenos e intolerancias en hostelería"
-- REESCRITURA DIDÁCTICA (molde de docs/folvy_formacion_guia_contenido.md)
-- ----------------------------------------------------------------------------
-- REEMPLAZA el contenido sembrado por 20260806T1600 (versión esquemática,
-- partida del dosier de Julio). Mismo `code`, mismo id: no rompe asignaciones
-- ni las firmas ya emitidas (que guardan course_version).
--
-- ⚠️ SUBE course.version a 2 — el contenido cambia sustancialmente. Las actas
--    ya firmadas seguirán diciendo que se firmó la v1; las nuevas dirán v2.
--
-- Base de contenido: dosier de Julio Gª Colón (los 14 alérgenos y los POE de
-- recepción/cocina/sala se conservan íntegros en dato y rigor). Lo que cambia
-- es CÓMO se cuenta: se añade el porqué, el caso real de cocina y el recuadro
-- técnico, y el test pasa a ser SITUACIONAL.
--
-- MARCO LEGAL: Reg. (UE) 1169/2011 (Anexo II, los 14) · RD 126/2015 (información
-- alimentaria de alimentos sin envasar en España) · Reg. (CE) 852/2004.
--
-- Correctas del test: b d a c b d c a b c (verificado, posición variada)
--
-- Se mantiene status 'published' (ya estaba publicado y en uso real).
-- DEPENDE DE: 20260806T1500_formacion_c1.sql
-- IDEMPOTENTE. Aplicada:
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
    null, 'alergenos_intolerancias',
    'Gestión de alérgenos e intolerancias en hostelería',
    'Los 14 alérgenos de declaración obligatoria, cómo evitar la contaminación cruzada y qué contestar cuando un cliente pregunta. Lo que puede salvar una vida en tu turno.',
    'Reglamento (UE) 1169/2011 · Real Decreto 126/2015',
    'folvy_imparte', 12, true, true, 25, 70, 2, 'published'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis, reeval_months = excluded.reeval_months,
    estimated_minutes = excluded.estimated_minutes,
    version = excluded.version
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'alergenos_intolerancias' and account_id is null;
  end if;

  delete from public.course_option
   where question_id in (select id from public.course_question where course_id = v_course_id);
  delete from public.course_question where course_id = v_course_id;
  delete from public.course_section  where course_id = v_course_id;

  -- ═══ TEORÍA ═══════════════════════════════════════════════════════════════

  insert into public.course_section (course_id, ord, title, body) values

  (v_course_id, 1, 'Una miga puede mandar a alguien al hospital',
$md$Hay dos cosas que se confunden todo el rato y no son lo mismo. Conviene tenerlo claro, porque la gravedad es muy distinta.

**Alergia**: el cuerpo confunde una proteína del alimento con un enemigo y se defiende con todo. Basta una cantidad mínima —**una miga, unas gotas, restos en un cuchillo**— para desencadenarla. En el peor caso provoca un **shock anafiláctico**, que puede matar en minutos.

**Intolerancia**: el cuerpo no digiere bien algo (el caso típico es la lactosa). Sienta fatal, provoca dolor y malestar digestivo, pero normalmente no pone la vida en riesgo de forma inmediata.

Los dos merecen respeto. Pero cuando alguien dice "soy alérgico", la palabra que tienes que oír es **hospital**, no "molestia".

Y aquí está lo que hace esto difícil: **la cantidad no importa y no se ve**. Puedes hacer todo bien, tener el plato impecable, y aun así haber pasado el alérgeno con un utensilio que no lavaste. Eso se llama **contaminación cruzada** y es la forma en la que casi siempre ocurren los accidentes: no por poner el ingrediente a propósito, sino por un roce.

**En tu cocina esto pasa así:** el cliente avisa de su alergia, tú preparas su plato sin ese ingrediente, y todo va bien... hasta que usas la misma pinza con la que acabas de tocar pan. Eso basta.

> **Marco legal** — Reglamento (UE) 1169/2011: obliga a informar de la presencia de los 14 alérgenos del Anexo II. RD 126/2015: regula la información en alimentos sin envasar (lo que se sirve en hostelería). La información debe estar disponible y ser veraz **antes** de que el cliente consuma.$md$),

  (v_course_id, 2, 'Los 14 que hay que declarar por ley',
$md$No son "los alérgenos más comunes": son una lista cerrada que fija la ley europea. De estos 14 **hay que poder informar siempre**, plato a plato.

**1. Cereales con gluten** — Trigo, centeno, cebada, avena, espelta, kamut e híbridos. En pan, rebozados, pasta, y en salsas espesadas con harina (esta es la que más se escapa).

**2. Crustáceos** — Gambas, langostinos, cangrejo, langosta. También en pastas de gamba y caldos concentrados.

**3. Huevos** — En mayonesas, rebozados, postres, pasta al huevo y en el pincelado de la bollería.

**4. Pescado** — Todo pescado, más surimi, salsas y caldos de pescado, y gelatinas.

**5. Cacahuetes** — Enteros, en aceite, en mantequilla, en toppings de cocina asiática y repostería.

**6. Soja** — Salsa de soja, tofu, edamame, brotes y **lecitina de soja (E-322)**, que aparece en muchísimos productos.

**7. Leche y derivados** — Incluida la lactosa: queso, mantequilla, nata, yogur, y el suero lácteo escondido en embutidos y salsas.

**8. Frutos de cáscara** — Almendra, avellana, nuez, anacardo, pistacho, macadamia, pacana, castaña de Pará. Pesto y pralinés.

**9. Apio** — En rama, en raíz, sal de apio, y en caldos y fondos de verdura procesados.

**10. Mostaza** — En grano, en polvo, en salsas preparadas, aliños y marinados.

**11. Sésamo** — Semillas en panes, aceite de sésamo, tahini, hummus.

**12. Sulfitos** — Por encima de 10 mg/kg o 10 mg/l. En vinos, vinagres, frutos secos desecados y conservas de patata.

**13. Altramuces** — Enteros y en harina, presente en panadería y aperitivos.

**14. Moluscos** — Mejillón, almeja, calamar, pulpo, ostra, caracol y sus extractos.

**En tu cocina esto pasa así:** los que dan sustos no son los evidentes. Nadie se olvida de que la merluza es pescado. Los que se cuelan son **el apio del caldo, la harina de la salsa, la lecitina de soja del pan de hamburguesa y los sulfitos del vino de un guiso**. Por eso la respuesta nunca se da de memoria: se mira la ficha.

> **Datos técnicos** — Anexo II del Reglamento (UE) 1169/2011. Los sulfitos solo se declaran en concentraciones superiores a 10 mg/kg o 10 mg/litro expresadas como SO₂. La lista es cerrada: no se añaden ni se quitan alérgenos por criterio del establecimiento.$md$),

  (v_course_id, 3, 'Antes de cocinar: recepción y almacén',
$md$La prevención empieza mucho antes del servicio, cuando llega la mercancía.

**Lee las etiquetas al recibir.** Los alérgenos vienen destacados en negrita o cursiva dentro de la lista de ingredientes. Y ojo: **un proveedor puede cambiar la fórmula sin avisar**. El producto de siempre puede llevar hoy algo que antes no llevaba.

**Guarda lo "sin" arriba y aislado.** El pan sin gluten, la bebida vegetal, el producto especial para alérgicos: en estantes superiores o en un armario aparte, cerrados y etiquetados. El motivo es físico: **la harina cae**. Si el producto sin gluten está debajo de un saco de harina, se contamina solo con abrirlo.

**No trasvases sin etiquetar.** En cuanto sacas algo de su envase original, pierdes la lista de ingredientes. Un bote sin etiqueta es un bote del que ya nadie puede informar con seguridad.

**En tu cocina esto pasa así:** alguien pasa las salsas a biberones para ir más rápido en el pase. Tres días después nadie recuerda cuál de los dos biberones amarillos lleva mostaza. Ese día, si viene un alérgico a la mostaza, no hay forma segura de responder.

> **Datos técnicos** — Reg. (UE) 1169/2011, art. 21 y Anexo II: los alérgenos deben destacarse tipográficamente en la lista de ingredientes. La información debe conservarse y ser trazable hasta el plato servido; los productos trasvasados deben mantener identificado su contenido.$md$),

  (v_course_id, 4, 'En cocina: el calor NO destruye el alérgeno',
$md$Esto es lo más importante de todo el curso, y es lo que más gente cree al revés.

**El calor mata bacterias. NO destruye los alérgenos.** La proteína que provoca la alergia aguanta la fritura, el horno y la plancha. Un aceite donde se han freído croquetas empanadas lleva gluten dentro, y seguirá llevándolo por muchas horas y muchos grados que pasen.

De ahí salen las reglas de cocina:

**Freidora y plancha no se comparten.** Las patatas de un celíaco **nunca** se fríen en el aceite de los rebozados. No hay tiempo de fritura ni escurrido que lo arregle.

**Prepara en limpio.** Antes de una comanda con alergia: limpia y desinfecta la superficie, lávate las manos y ponte delantal limpio. Utillaje exclusivo o recién higienizado: tabla, cuchillo, sartén, pinzas.

**Si te equivocas, el plato se tira entero.** Si cae queso en la hamburguesa de un alérgico a la leche, **no se retira con el tenedor**. La proteína ya está en la carne, en el pan y en el jugo. Se desecha todo y se hace de nuevo desde cero, con material limpio. Cuesta unos euros. Lo otro puede costar una vida.

**En tu cocina esto pasa así:** es sábado noche, hay veinte comandas y solo queda libre la freidora de los rebozados. La tentación de "es solo un momento" es real y humana. Ahí es donde ocurren los accidentes graves: no por ignorancia, sino por prisa.

> **Datos técnicos** — Las proteínas alergénicas son termoestables: no se inactivan con las temperaturas de cocinado. Reg. (CE) 852/2004, Anexo II Cap. IX: obligación de evitar la contaminación de los alimentos en todas las fases. La eliminación mecánica de un ingrediente alergénico de un plato ya elaborado NO es una medida válida.$md$),

  (v_course_id, 5, 'En sala: lo que dices y cómo lo llevas',
$md$La sala es donde la información llega al cliente, y donde más fácil es fallar.

**Anota la alerta y hazla imposible de ignorar.** En la comanda, bien visible: *"¡¡ALERGIA GRAVE AL GLUTEN!!"*. Y comunícalo **en voz alta** al jefe de cocina, no solo por el TPV. Si nadie la ha oído, la comanda puede pasar como una más.

**Llévalo aparte.** El plato del alérgico va solo, no apretado en la misma bandeja rozando otros platos. Y al servirlo, se identifica en voz alta: *"esta es la sin gluten"*. Así el propio cliente confirma que es la suya.

**Y lo más importante: si no estás seguro, no contestes.** Consulta la ficha del plato o pregunta a cocina. Siempre.

Hay tres respuestas que **nunca** se dan:
- *"Creo que no lleva."* — El "creo" no vale para algo que puede matar.
- *"Yo diría que no, pero mira tú a ver."* — La responsabilidad de informar es del establecimiento; no se traslada al cliente.
- *"No lleva"* dicho deprisa para no perder la venta. — Es la peor de todas.

**En tu cocina esto pasa así:** el cliente pregunta con cola en la barra y prisa alrededor. Cuesta decir "déjeme comprobarlo, un momento". Pues es exactamente lo que hay que decir. Ese minuto no le arruina la noche a nadie; equivocarse, sí.

> **Datos técnicos** — RD 126/2015: en alimentos sin envasar la información sobre alérgenos debe facilitarse de forma **veraz, accesible y gratuita**, por escrito o verbalmente, antes de que finalice la compra. Debe existir información documentada por plato a la que el personal pueda acceder.$md$),

  (v_course_id, 6, 'Cuando algo sale mal',
$md$Puede pasar. Y lo que hagas en los primeros minutos importa mucho.

**Si sospechas que un plato ha podido contaminarse**, párate antes de que salga. Aún estás a tiempo. Un plato retirado no es un error: es el sistema funcionando.

**Si un cliente empieza a encontrarse mal** —picor, hinchazón de labios o lengua, ronchas, dificultad para respirar, mareo—:
- **Avisa al responsable de inmediato.** No lo gestiones solo.
- Si tiene dificultad para respirar, se hincha la cara o la garganta, o pierde el conocimiento: **112, sin dudarlo**. La anafilaxia va en minutos.
- Si el cliente lleva su autoinyector de adrenalina, que lo use él o quien le acompaña.
- **No tires nada**: guarda el plato, el envase y los registros. Es lo que permitirá saber qué pasó y lo que va a defender al local.

**Y después**: cuéntalo, aunque quede mal. Un incidente que se oculta se repite; uno que se registra se corrige. En Folvy queda como incidencia y puede disparar formación de refuerzo para el equipo implicado. Eso no es un castigo: es la forma de que no vuelva a ocurrir.

**En tu cocina esto pasa así:** lo más difícil no es saber qué hacer, es **decirlo**. El miedo a la bronca hace que la gente calle. Un local que trata bien el aviso de un fallo es un local que no tiene accidentes graves.

> **Datos técnicos** — Reg. (CE) 178/2002, art. 19: obligación de retirar del mercado el producto e informar a las autoridades competentes si se detecta un riesgo para la salud. Conservación de muestras y registros para la investigación del incidente.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b d a c b d c a b c

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Un cliente celíaco pide patatas fritas. La única freidora libre es la de los rebozados. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Las frío ahí: el aceite está a más de 170 °C y el calor destruye el gluten.', false, 'Falso y peligroso: el calor mata bacterias, NO destruye los alérgenos.'),
   (v_q, 'No las frío ahí. Espero a la freidora limpia o le ofrezco otra guarnición explicándole por qué.', true, 'Correcto. El aceite de los rebozados lleva gluten y lo pasa a las patatas.'),
   (v_q, 'Las frío ahí pero las escurro bien y las seco con papel.', false, 'Escurrir no elimina la proteína que ya ha pasado al alimento.'),
   (v_q, 'Las frío ahí y aviso al cliente de que "puede llevar trazas".', false, 'No es una traza: es contaminación segura. Y avisar no legitima servir algo inseguro.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Ya emplatada la hamburguesa de un cliente alérgico a la leche, ves que lleva queso por error. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Retiro el queso con unas pinzas y la sirvo.', false, 'La proteína láctea ya está en la carne, el pan y el jugo. Retirarlo no la quita.'),
   (v_q, 'Cambio solo la carne y aprovecho el pan.', false, 'El pan también ha estado en contacto con el queso fundido.'),
   (v_q, 'La paso por la plancha para que el queso se funda y no se note.', false, 'El calor no destruye el alérgeno; solo esconde el error.'),
   (v_q, 'Tiro el plato entero y lo hago de nuevo desde cero con material limpio.', true, 'Correcto. Es la única opción segura. Cuesta unos euros; lo otro puede costar una vida.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'Un cliente pregunta si el guiso lleva apio. Tú no lo has cocinado y no estás seguro. Hay cola en la barra.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le digo que espere un momento, consulto la ficha del plato o pregunto a cocina, y luego respondo.', true, 'Correcto. Ese minuto no le arruina la noche a nadie; equivocarse, sí.'),
   (v_q, 'Le digo que creo que no lleva, pero que decida él.', false, 'La responsabilidad de informar es del establecimiento. No se traslada al cliente.'),
   (v_q, 'Le digo que no lleva: es un guiso de carne, no una ensalada.', false, 'El apio está en muchísimos caldos y fondos de verdura. Es uno de los que más se escapan.'),
   (v_q, 'Le recomiendo otro plato para no complicarme.', false, 'Esquivar no es informar: tiene derecho a saber lo que lleva cada plato.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, 'Para ir más rápido en el pase, un compañero ha pasado varias salsas a biberones sin etiqueta. ¿Qué problema hay?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Ninguno, mientras se gasten el mismo día.', false, 'El problema aparece en cuanto alguien que no las preparó tiene que informar.'),
   (v_q, 'Solo que puede confundirse el sabor de un plato.', false, 'El problema no es de sabor: es que no se puede informar con seguridad.'),
   (v_q, 'Que al salir del envase original se pierde la lista de ingredientes y ya no se puede informar con seguridad de sus alérgenos.', true, 'Correcto. Todo lo trasvasado se etiqueta con su contenido y su fecha.'),
   (v_q, 'Que ocupan más espacio en la cámara.', false, 'Nada que ver con la seguridad del cliente alérgico.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, '¿Dónde guardas el pan sin gluten en el almacén?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Junto al pan normal, para tenerlo todo localizado.', false, 'La harina del pan normal contamina el que está al lado.'),
   (v_q, 'En un estante superior o armario aparte, cerrado y etiquetado.', true, 'Correcto. La harina cae por gravedad: lo "sin" va arriba y aislado.'),
   (v_q, 'Debajo de los sacos de harina, que abajo hay más sitio.', false, 'Es el peor sitio posible: cae harina cada vez que se manipula el saco.'),
   (v_q, 'En cualquier sitio mientras esté en su bolsa.', false, 'La bolsa se abre y se manipula; la separación física es la barrera.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Un cliente con alergia al marisco empieza a tener ronchas y le cuesta respirar. ¿Qué es lo primero?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Le doy un vaso de agua y espero a ver si se le pasa.', false, 'La anafilaxia progresa en minutos. Esperar es lo más peligroso.'),
   (v_q, 'Retiro el plato y limpio la mesa para que no empeore.', false, 'Retirar el plato no ayuda a la persona, y además hay que conservarlo.'),
   (v_q, 'Busco en la ficha qué llevaba el plato antes de hacer nada.', false, 'Eso se hace después. Primero la persona.'),
   (v_q, 'Llamo al 112 y aviso al responsable de inmediato; si lleva autoinyector, que se use.', true, 'Correcto. Dificultad para respirar = emergencia. No se espera y no se gestiona solo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, 'Llega el proveedor con el pan de hamburguesa de siempre. ¿Hay que mirar la etiqueta?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No, es el mismo producto que pedimos cada semana.', false, 'Un proveedor puede cambiar la fórmula sin avisar. Es un riesgo real y frecuente.'),
   (v_q, 'No, basta con mirarla la primera vez que se compra un producto.', false, 'La reformulación puede llegar en cualquier entrega posterior.'),
   (v_q, 'Sí: hay que revisar los alérgenos destacados en cada recepción, porque el proveedor puede haber cambiado la fórmula.', true, 'Correcto. La etiqueta se revisa siempre, no solo la primera vez.'),
   (v_q, 'Solo si el envase tiene otro color.', false, 'La fórmula puede cambiar sin que cambie nada del aspecto del envase.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Sale un plato para un cliente con alergia grave. ¿Cómo lo llevas a la mesa?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Solo, sin que roce otros platos, y lo identifico en voz alta al servirlo.', true, 'Correcto. Aparte, identificado, y confirmado con el propio cliente.'),
   (v_q, 'En la misma bandeja que el resto, pero en el borde.', false, 'El roce entre platos y los saltos de salsa transfieren alérgenos.'),
   (v_q, 'En la misma bandeja, avisando al llegar de cuál es cada uno.', false, 'El riesgo ya se ha producido durante el transporte.'),
   (v_q, 'Le pido al cliente que lo recoja en barra para no confundirme.', false, 'No es el procedimiento y no garantiza que no se haya contaminado antes.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Un cliente dice que es intolerante a la lactosa, no alérgico. ¿Cambia algo?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sí: como no es alergia, puedo servirle el plato con un poco de nata.', false, 'Le sentará mal igualmente. Que no sea mortal no significa que dé igual.'),
   (v_q, 'El riesgo vital es menor que en una alergia, pero se informa y se respeta exactamente igual: hay que decirle la verdad de lo que lleva el plato.', true, 'Correcto. Cambia la gravedad clínica, no la obligación de informar ni el respeto al cliente.'),
   (v_q, 'No hace falta consultar la ficha: la intolerancia no está regulada.', false, 'La leche y la lactosa son el alérgeno 7 de declaración obligatoria.'),
   (v_q, 'Le digo que no podemos atender intolerancias, solo alergias.', false, 'Hay obligación de informar, y negar el servicio así no tiene fundamento.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, 'Estás montando una ensalada para un cliente alérgico al huevo. Acabas de usar las pinzas para emplatar otra con mayonesa. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Las uso igual: apenas ha quedado mayonesa en ellas.', false, 'Basta una cantidad mínima. Ese resto invisible es exactamente el riesgo.'),
   (v_q, 'Las limpio con un paño de cocina y sigo.', false, 'El paño reparte en vez de eliminar, y suele estar contaminado.'),
   (v_q, 'Cojo pinzas limpias (o las higienizo) y me lavo las manos antes de seguir.', true, 'Correcto. Utillaje exclusivo o recién higienizado, y manos lavadas al cambiar de tarea.'),
   (v_q, 'Las enjuago con agua fría rápidamente.', false, 'Un enjuague rápido no arrastra el resto graso de la mayonesa.');

  raise notice 'Curso alérgenos reescrito (didáctico, v2). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (ejecutar POR SEPARADO) ───────────────────────────────────
-- select c.code, c.status, c.version,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='alergenos_intolerancias' and c.account_id is null;
-- Esperado: published · version 2 · 6 secciones · 10 preguntas · 10 correctas.
