-- ============================================================================
-- Folvy · CURSO "Limpieza y cierre: cómo se deja la cocina"
-- Molde: docs/folvy_formacion_guia_contenido.md · Catálogo v2 Bloque B (cocina)
-- ----------------------------------------------------------------------------
-- Sexto y último curso del bloque cocina. Cierra el bloque: escandallo, mermas,
-- inventario, recepción, conservación y ahora el cierre — el turno que decide
-- cómo empieza el siguiente.
--
-- TAXONOMÍA: category='cocina' · business_types={todos} · level='base'
--            requires_practical=true (ejecutar un cierre completo con el responsable)
--
-- ⚠️ REVISIÓN DE JULIO PENDIENTE — status 'draft'.
--
-- Correctas del test: b a d c b d a c b a (verificado)
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
    null, 'limpieza_cierre',
    'Limpieza y cierre: cómo se deja la cocina',
    'Limpiar no es desinfectar, el cierre no es barrer, y cómo dejas la cocina decide cómo empieza el turno de mañana.',
    'Reglamento (CE) 852/2004, Anexo II Cap. I, II y V',
    'folvy_imparte', 24, false, true, 20, 70, 1, 'draft'
  )
  on conflict (code) where account_id is null
  do update set title = excluded.title, summary = excluded.summary,
    legal_basis = excluded.legal_basis,
    reeval_months = excluded.reeval_months, estimated_minutes = excluded.estimated_minutes
  returning id into v_course_id;

  if v_course_id is null then
    select id into v_course_id from public.course
     where code = 'limpieza_cierre' and account_id is null;
  end if;

  if exists (select 1 from information_schema.columns where table_name='course' and column_name='category') then
    execute format('update public.course set category=%L, level=%L, recommended_order=%s where id=%L',
                   'cocina', 'base', 250, v_course_id);
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

  (v_course_id, 1, 'El cierre no es recoger: es preparar el día siguiente',
$md$El turno de cierre tiene mala fama porque llega cuando ya no puede más nadie. Es tarde, se ha trabajado, y lo único que apetece es irse.

Y sin embargo, **cómo dejas la cocina decide cómo empieza el turno de mañana**. Una cocina bien cerrada arranca en diez minutos. Una mal cerrada se pasa la primera hora limpiando lo de ayer, con el servicio ya encima.

Además, el cierre es el momento en que se hacen cosas que **no se pueden hacer con la cocina en marcha**: limpiar a fondo, desinfectar superficies, revisar temperaturas sin puertas abriéndose, contar sin que entre y salga producto.

**Y hay un tercer motivo, que es el que menos se dice:** una inspección no avisa. Puede llegar a las once de la mañana y encontrarse la cocina como la dejó el turno de noche. **Lo que se ve entonces no es cómo trabajas: es cómo cierras.**

**En tu cocina esto pasa así:** el cierre se hace deprisa cuando el turno ha sido duro — que es justo cuando más falta hace, porque es cuando más suciedad se ha generado. Por eso el cierre no se improvisa: **se hace por lista**, siempre la misma, aunque haya prisa. Una lista es lo único que aguanta el cansancio.

> **Marco legal** — Reg. (CE) 852/2004, Anexo II, Cap. I y II: los locales, superficies y equipos deben mantenerse limpios y en buen estado. El plan de limpieza y desinfección es uno de los prerrequisitos del sistema de autocontrol, con sus registros exigibles en inspección.$md$),

  (v_course_id, 2, 'Limpiar no es desinfectar',
$md$Son dos cosas distintas y hacen falta las dos, en este orden.

**Limpiar** quita la suciedad que ves: grasa, restos, manchas. Se hace con detergente.

**Desinfectar** mata los microorganismos que no ves. Se hace con desinfectante.

**Y el orden importa muchísimo:** desinfectar sobre suciedad **no sirve de nada**. El producto se consume neutralizando la grasa y no llega a los microorganismos. Es dinero y tiempo tirados, con la sensación de haberlo hecho bien.

**La secuencia correcta, siempre igual:**
1. **Retirar** restos sólidos.
2. **Limpiar** con detergente y agua.
3. **Aclarar.**
4. **Desinfectar**, respetando dosis y tiempo.
5. **Aclarar** de nuevo si el producto lo exige.
6. **Secar** — la humedad es donde vuelve a crecer todo.

**Dosis y tiempo de contacto no son opcionales.** Son los dos errores clásicos:
- **Echar de menos**: no desinfecta. Solo huele a limpio.
- **Echar de más**: deja residuo químico en la superficie donde luego apoyas comida. Y no desinfecta mejor.
- **No esperar**: un desinfectante necesita minutos actuando. Si lo pasas y lo secas al momento, no ha hecho nada.

**En tu cocina esto pasa así:** "echar un poco más por si acaso" está tan extendido como saltarse el aclarado. Las dos cosas convierten la desinfección en un gesto simbólico — y encima la segunda mete un peligro químico donde antes solo había grasa.

> **Datos técnicos** — La eficacia de un desinfectante depende de la concentración, el tiempo de contacto y que la superficie esté previamente limpia. La ficha técnica del producto indica ambos parámetros: son de obligado cumplimiento, no orientativos.$md$),

  (v_course_id, 3, 'Lo que más se olvida',
$md$Las superficies grandes se limpian siempre. Lo que se olvida es lo pequeño y lo que no se ve — que suele ser lo más sucio:

- **Bayetas y estropajos.** De lo más contaminado de una cocina. Se cambian a diario o, mejor, se sustituyen por papel de un solo uso. Una bayeta sucia **reparte** en vez de limpiar.
- **Mangos y tiradores.** Puertas de cámara, grifos, cajones, interruptores. Se tocan con las manos sucias todo el día y casi nunca se limpian.
- **Juntas de goma de las cámaras.** Acumulan restos y moho. Se ven cuando alguien las mira, y casi nadie las mira.
- **Cortadora, picadora, batidora.** Se desmontan para limpiar. Lo que queda entre las piezas es el mejor cultivo de la cocina.
- **Desagües y sumideros.** Foco de olores y de plagas.
- **Debajo y detrás de los equipos.** Donde caen los restos y donde se instalan los roedores.
- **Tablas.** Se lavan y desinfectan, y se retiran cuando están muy rayadas: los cortes profundos ya no se pueden limpiar del todo.
- **Cubos de basura.** Se lavan, no solo se cambia la bolsa.

**En tu cocina esto pasa así:** el suelo se friega todos los días y las juntas de la cámara no se han tocado en un mes. Lo que se ve se limpia; lo que no se ve, no. Y una inspección mira exactamente lo segundo, porque es lo que revela cómo se trabaja de verdad.

> **Datos técnicos** — Reg. (CE) 852/2004, Anexo II Cap. V: los objetos y equipos que entren en contacto con alimentos deben poder limpiarse y desinfectarse eficazmente. Una superficie deteriorada (tabla muy rayada, plástico agrietado) deja de ser higienizable y debe reponerse.$md$),

  (v_course_id, 4, 'Los productos químicos: donde más fácil es hacer daño',
$md$Este es el punto donde una limpieza mal hecha pasa de ser ineficaz a ser **peligrosa**.

**Reglas que no se negocian:**

- **Cada producto en su envase original y etiquetado.** Nunca en una botella de agua ni en un bote sin identificar. Ha habido intoxicaciones graves por esto.
- **Almacenados aparte de los alimentos.** Nunca en la misma estantería, nunca encima.
- **No mezclar nunca productos.** Lejía con amoniaco, o lejía con ácidos, generan **gases tóxicos**. No es una exageración: manda gente al hospital cada año.
- **Aclarar bien** todo lo que va a tocar comida.
- **Guantes** cuando el producto lo indique. Y **ventilación** al usar productos fuertes.
- **Nunca cerca de alimentos destapados.** Un pulverizador alcanza mucho más lejos de lo que parece.

**Y la parte que a veces sorprende:** el residuo químico también es un **peligro alimentario**, igual que una bacteria. Está en la lista de los tres peligros del curso de manipulador: biológico, **químico** y físico. Una encimera mal aclarada contamina el plato que apoyes encima.

**En tu cocina esto pasa así:** el trasvase a otra botella "porque el bote es muy grande" es el gesto que más riesgo genera de toda la limpieza. Nadie lo hace con mala intención — y es exactamente cómo alguien acaba bebiendo desengrasante.

> **Datos técnicos** — Reg. (CE) 852/2004, Anexo II Cap. I: los productos de limpieza y desinfección no deben almacenarse en zonas donde se manipulen alimentos. La contaminación química es uno de los tres tipos de peligro contemplados en el sistema APPCC.$md$),

  (v_course_id, 5, 'El cierre, paso a paso',
$md$La lista concreta la tiene tu local. Pero el esquema es siempre este, y el orden ahorra tiempo:

**1. Producto primero.** Guardar todo lo que quede: tapado, etiquetado y con fecha. Nada se queda fuera "hasta mañana".

**2. Retirar y tirar.** Lo que no se puede conservar, se desecha — **y se registra como merma**. Es el momento del turno en que más merma se genera y menos se anota.

**3. Equipos.** Apagar planchas y freidoras, limpiar en frío o templado según cada una. Filtros de campana según el plan.

**4. Superficies.** Limpiar y desinfectar encimeras, tablas y utillaje, con la secuencia completa.

**5. Suelos y desagües**, al final: se limpia de arriba abajo, no al revés.

**6. Basura fuera**, cubos lavados, bolsas nuevas.

**7. Comprobaciones finales**: temperaturas de cámaras y congeladores, que todo esté cerrado, gas y equipos apagados, luces, puertas y ventanas.

**8. Registros.** Rellenar lo que toque: temperaturas, limpieza, incidencias. **En el momento, no de memoria mañana.**

**9. Dejar preparado lo que ahorre tiempo mañana**: material recogido, cada cosa en su sitio.

**Y una regla de oro del cierre: lo que encuentres roto, agotado o raro, se comunica esa noche.** Una cámara que no enfría bien descubierta al cerrar se puede arreglar antes de que se estropee todo. Descubierta a las nueve de la mañana, ya es tarde.

**En tu cocina esto pasa así:** los registros son lo primero que se cae cuando hay prisa. Y son justo lo único que queda como prueba de que todo lo demás se hizo. Un cierre perfecto sin registrar **es, ante una inspección, un cierre que no existió.**

> **Datos técnicos** — Los registros de limpieza y de temperaturas forman parte de la documentación del sistema de autocontrol y deben cumplimentarse en el momento de realizar la tarea, conservándose a disposición de la autoridad competente.$md$),

  (v_course_id, 6, 'Qué se espera de ti',
$md$Seis cosas:

**1. Cierra por lista, siempre la misma**, aunque estés cansado. La lista es lo que aguanta el cansancio.

**2. Limpia antes de desinfectar**, con su dosis y su tiempo. Sin eso, la desinfección no existe.

**3. Los químicos, en su envase, etiquetados, aparte de la comida, y sin mezclar nunca.**

**4. Ocúpate de lo que no se ve**: juntas, mangos, desagües, debajo de los equipos.

**5. Registra lo que hagas**, en el momento. Y anota la merma del cierre.

**6. Comunica lo que encuentres roto o raro esa misma noche.** No mañana.

**Y una idea para terminar el bloque de cocina:** todo lo que has visto en estos cursos —el gramaje, la merma, el conteo, la recepción, la conservación, el cierre— es la misma cosa vista desde seis sitios distintos. **Una cocina que hace bien esas seis cosas gana dinero, pasa inspecciones sin sudar y trabaja más tranquila.** Una que no, va apagando fuegos.

**La idea que resume el curso:**

> Cómo dejas la cocina es cómo empieza el turno de mañana. Y es lo que ve una inspección que llega sin avisar.

**Antes de terminar**: pregunta dónde está la lista de cierre de tu local. Si no hay ninguna, ahí tienes lo primero que falta.

> **Datos técnicos** — El plan de limpieza y desinfección debe especificar qué se limpia, con qué frecuencia, con qué producto, a qué dosis y quién lo hace. Sin esos cuatro datos por escrito, no es un plan: es una costumbre.$md$);

  -- ═══ TEST SITUACIONAL ═════════════════════════════════════════════════════
  -- Correctas: b a d c b d a c b a

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 1, 'Vas a desinfectar la encimera después de un servicio con mucha grasa. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Aplico desinfectante directamente y lo dejo actuar.', false, 'Sobre grasa, el producto se consume neutralizándola y no llega a los microorganismos.'),
   (v_q, 'Retiro restos, limpio con detergente, aclaro y luego desinfecto respetando dosis y tiempo.', true, 'Correcto. Desinfectar sobre suciedad no sirve de nada.'),
   (v_q, 'Echo doble dosis de desinfectante para compensar la grasa.', false, 'Más producto no compensa: además deja residuo químico donde apoyas comida.'),
   (v_q, 'Limpio con detergente y ya está: el detergente también desinfecta.', false, 'Limpiar quita suciedad visible; desinfectar mata microorganismos. Son cosas distintas.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 2, 'Queda poco desinfectante y hay que cerrar. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Aviso y consigo producto: por debajo de la dosis no desinfecta y es tiempo perdido.', true, 'Correcto. Media dosis da sensación de limpio sin serlo.'),
   (v_q, 'Echo la mitad de dosis: algo hará.', false, 'Por debajo de la concentración indicada, el producto no es eficaz.'),
   (v_q, 'Lo diluyo con más agua para que llegue a todo.', false, 'Diluirlo es exactamente bajar la dosis.'),
   (v_q, 'Lo dejo para mañana y limpio solo con detergente.', false, 'Puede ser una salida puntual, pero hay que avisarlo, no ocultarlo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 3, 'El bote de desengrasante es enorme e incómodo. Un compañero lo pasa a una botella de agua.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Bien, siempre que se use en el día.', false, 'El riesgo existe desde el primer momento.'),
   (v_q, 'Bien, si se le pone una marca con rotulador.', false, 'Una marca no es una etiqueta: sigue pareciendo una botella de agua.'),
   (v_q, 'Bien, mientras se guarde lejos de la comida.', false, 'El problema principal es que parece agua potable.'),
   (v_q, 'Mal: los químicos van en su envase original y etiquetados. Así es como alguien acaba bebiendo desengrasante.', true, 'Correcto. Es el gesto que más riesgo genera de toda la limpieza.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 4, '¿Qué NO se debe hacer nunca con los productos de limpieza?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Usarlos con guantes.', false, 'Al contrario: se usan cuando el producto lo indica.'),
   (v_q, 'Aclarar después de aplicarlos.', false, 'Aclarar es parte del procedimiento correcto.'),
   (v_q, 'Mezclar unos con otros: lejía con amoniaco o con ácidos genera gases tóxicos.', true, 'Correcto. Manda gente al hospital cada año.'),
   (v_q, 'Guardarlos en su envase original.', false, 'Eso es justo lo que hay que hacer.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 5, 'Al cerrar sobra producto preparado que no se puede conservar. ¿Qué haces?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Lo tiro sin más: ya no sirve.', false, 'Tirar sin registrar convierte la merma en un descuadre sin explicación.'),
   (v_q, 'Lo desecho y lo registro como merma.', true, 'Correcto. El cierre es el momento en que más merma se genera y menos se anota.'),
   (v_q, 'Lo guardo por si mañana se puede aprovechar.', false, 'Si ya sabes que no se puede conservar, guardarlo solo aplaza el problema.'),
   (v_q, 'Lo dejo fuera para la comida del personal.', false, 'Dejarlo fuera toda la noche lo pone en zona de peligro.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 6, 'Al cerrar ves que una cámara marca 9 °C. Es tarde y todos se van.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Bajo el termostato y me voy.', false, 'Puede no ser el termostato: la causa sigue sin conocerse.'),
   (v_q, 'Lo dejo anotado para que lo vean mañana.', false, 'Para mañana el producto lleva toda la noche a 9 °C.'),
   (v_q, 'Lo compruebo otra vez y, si sigue igual, mañana se decide.', false, 'La noche entera es justo el tiempo que no hay que dejar pasar.'),
   (v_q, 'Lo comunico esa misma noche: descubierto al cerrar aún se puede salvar el producto; descubierto mañana, ya no.', true, 'Correcto. Lo roto o raro se comunica en el momento.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 7, '¿Cuál de estas suele ser la zona más contaminada de una cocina?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Las bayetas y estropajos.', true, 'Correcto. Una bayeta sucia reparte en vez de limpiar: mejor papel de un solo uso.'),
   (v_q, 'El suelo, porque se pisa.', false, 'Se limpia a diario y no toca los alimentos directamente.'),
   (v_q, 'Las paredes.', false, 'Poco contacto y limpieza periódica.'),
   (v_q, 'La campana extractora.', false, 'Acumula grasa, pero no está en contacto directo con el alimento como una bayeta.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 8, 'Una tabla de corte está muy rayada, con surcos profundos, pero se lava bien.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Sirve mientras se lave a fondo.', false, 'Los surcos profundos ya no se pueden higienizar del todo.'),
   (v_q, 'Sirve si se usa solo para verdura.', false, 'La verdura también puede contaminarse.'),
   (v_q, 'Se retira: una superficie deteriorada deja de ser higienizable y hay que reponerla.', true, 'Correcto. Está recogido expresamente en la normativa de equipos.'),
   (v_q, 'Se le da la vuelta y se usa por el otro lado.', false, 'Aplaza el problema: el lado rayado sigue existiendo.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 9, 'Se ha hecho un cierre impecable, pero nadie rellenó los registros.')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'No pasa nada: lo importante es que la cocina esté limpia.', false, 'Ante una inspección, lo que no está registrado no se hizo.'),
   (v_q, 'Ante una inspección, ese cierre es como si no hubiera existido: los registros son la única prueba.', true, 'Correcto. Y por eso son lo primero que se cae cuando hay prisa.'),
   (v_q, 'Se rellenan mañana con los datos aproximados.', false, 'Un registro relleno después y de memoria es un registro falso.'),
   (v_q, 'Basta con que lo confirme el encargado de palabra.', false, 'La documentación del autocontrol tiene que estar escrita.');

  insert into public.course_question (course_id, ord, text) values
   (v_course_id, 10, '¿En qué orden se limpia al cerrar?')
   returning id into v_q;
  insert into public.course_option (question_id, text, is_correct, explanation) values
   (v_q, 'Primero guardar el producto, luego equipos y superficies, y los suelos al final.', true, 'Correcto. De arriba abajo, y el producto lo primero para que no espere fuera.'),
   (v_q, 'Primero los suelos, que es lo que más se ve.', false, 'Se ensuciarían otra vez al limpiar equipos y superficies.'),
   (v_q, 'Lo que cada uno vea antes, mientras quede todo hecho.', false, 'Sin orden se repite trabajo y se olvidan cosas.'),
   (v_q, 'Primero la basura y luego lo demás.', false, 'La basura sale al final, cuando ya se ha generado toda.');

  raise notice 'Curso de limpieza y cierre sembrado (draft, cocina). id: %', v_course_id;
end
$seed$;

-- ── VERIFICACIÓN (POR SEPARADO) ────────────────────────────────────────────
-- select c.code, c.status, c.category,
--   (select count(*) from course_section  s where s.course_id=c.id) as secciones,
--   (select count(*) from course_question q where q.course_id=c.id) as preguntas,
--   (select count(*) from course_option o join course_question q2 on q2.id=o.question_id
--     where q2.course_id=c.id and o.is_correct) as correctas
-- from course c where c.code='limpieza_cierre' and c.account_id is null;
-- Esperado: draft · cocina · 6 secciones · 10 preguntas · 10 correctas.
--
-- Y el bloque cocina completo (6 cursos):
-- select code, status from course where account_id is null and category='cocina' order by recommended_order;
