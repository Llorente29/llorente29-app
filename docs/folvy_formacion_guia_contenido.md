# Folvy — Formación · GUÍA DE CONTENIDO

> **Para qué sirve**: que los 9 cursos del catálogo salgan **igual de buenos**, los escriba quien los escriba y cuando sea. Es el molde de producción.
> **Curso de referencia**: "Higiene alimentaria — manipulador de alimentos". Si dudas de cómo hacer algo, mira cómo está hecho ahí.
> **Diseño del módulo**: `docs/folvy_formacion_diseno.md` · **Benchmark**: `docs/folvy_formacion_benchmark.md`

---

## 1. EL PRINCIPIO QUE MANDA

La evidencia sobre formación en seguridad alimentaria es incómoda y hay que tenerla delante: un metaanálisis no encontró correlación entre impartir formación y reducir brotes, y en varios estudios los trabajadores **sacaban buena nota en el test pero no cambiaban su conducta** de higiene.

> **Aprobar no es aprender, y aprender no es cambiar la conducta.**

Todo lo que sigue existe para atacar eso. Un curso que se aprueba sin cambiar lo que pasa en la cocina es un trámite legal caro, no formación.

**Consecuencias prácticas:**
- Se explica el **porqué**, no solo la norma. Quien entiende el motivo, lo aplica cuando nadie mira.
- Los ejemplos son **de su puesto de trabajo**, no abstractos.
- El test pregunta **qué harías**, no qué dice el reglamento.

## 2. EL MOLDE DE UNA SECCIÓN

Cada sección sigue este orden. Siempre.

1. **Título en lenguaje llano** — "Las bacterias tienen su temperatura favorita", no "Control de temperaturas".
2. **La idea, explicada por qué funciona así** — 2-4 párrafos cortos, con una imagen mental si ayuda ("las bacterias son seres vivos: si están a gusto, comen y se reproducen").
3. **La ilustración** — esquema o foto, según la regla del punto 4.
4. **"En tu cocina esto pasa así"** — un caso concreto y reconocible, con el error que de verdad se comete. No el ejemplo de manual.
5. **Recuadro técnico** (blockquote `>`) — las cifras exactas, los umbrales y la referencia legal. Es lo que consulta el que ya sabe, y lo que da rigor ante un inspector.

**Extensión**: 5-7 secciones por curso. Un curso debe hacerse **en 15-30 minutos**, dentro del turno. Si se alarga, no se termina.

## 3. TONO

**Mezcla deliberada de dos registros**: cuerpo en lenguaje sencillo y directo, recuadro final en lenguaje técnico-legal preciso. El que va justo aprende con el primero; el que necesita el dato exacto lo tiene en el segundo.

- **Tuteo.** Se habla a la persona, no al "personal".
- **Frases cortas.** Una idea por frase.
- **Sin jerga sin explicar.** Si aparece "ovoproducto" o "responsable del tratamiento", se explica la primera vez.
- **Sin miedo gratuito, sin frivolidad.** Se dice lo que está en juego (una intoxicación, una sanción) sin dramatizar.
- **Nada de "el manipulador deberá..."**. Se dice "lávate las manos cuando...".

**Adaptación por familia de curso** (el tono no cambia, los ejemplos sí):
- *Sanitarios* (manipulador, alérgenos, APPCC) → ejemplos de cámara, plancha, pase, reparto.
- *Legal-laborales* (igualdad, LGTBI, RGPD, canal de denuncias) → ejemplos de vestuario, cuadrante, grupo de WhatsApp del equipo, cámaras del local, trato entre compañeros y con clientes.

## 4. IMÁGENES: cuál usar y cuándo

La decisión **no es estética, es pedagógica**. Depende del objetivo de la sección:

| Si el objetivo es… | Usa… | Por qué |
|---|---|---|
| Entender algo **invisible o abstracto** (zona de peligro, contaminación cruzada, qué es un dato personal) | **Esquema propio** (SVG) | La foto no puede mostrar bacterias ni conceptos. El esquema hace visible lo abstracto y elimina ruido. |
| **Reconocer** algo en su sitio de trabajo (indicios de plaga, moho, envase hinchado, alérgeno en negrita en una etiqueta) | **Foto real** | Tiene que identificarlo entre cacharros y con prisa. Un dibujo limpio no entrena el ojo. |
| **Ejecutar** un procedimiento (lavado de manos, orden de la cámara) | **Foto secuenciada**, mejor si es de su cocina | Máxima transferencia: se ve a sí mismo en el sitio real. |

**Dónde vive cada cosa** (regla firme):
- **Esquemas y fotos genéricas de Folvy** → `public/formacion/` en el repo. Son contenido de producto: versionados, servidos por CDN, no dependen de un bucket.
- **Fotos propias del cliente** → Supabase Storage, namespeceadas por cuenta. Son datos del cliente.
- Nunca mezclar ambas cosas en el mismo sitio.

**Regla legal de imágenes**: jamás fotos sacadas de Google ni de proveedores. Solo esquemas propios, bancos con licencia clara (Pexels/Unsplash) o fotos del propio cliente.

**Un esquema, una idea.** Si necesita leyenda de cinco entradas, son dos esquemas.

## 5. EL TEST: preguntas de situación, no de definición

Es el cambio que más importa. Compara:

- ❌ *"¿Cuántos alérgenos son de declaración obligatoria?"* → memoria pura, se olvida al día siguiente.
- ✅ *"Llega el reparto y el pollo viene a 12 °C. ¿Qué haces?"* → decisión real, mide criterio.

**Reglas:**
- **10 preguntas**, 4 opciones, **una sola correcta**.
- Umbral de aprobado: **70%**.
- **La posición de la correcta debe variar** (a/b/c/d repartidas). ⚠️ Si todas las correctas caen en la misma letra, se aprueba marcando siempre igual sin leer — el certificado no valdría. **Verificar siempre antes de dar por bueno un test.**
- **Cada opción lleva explicación**, también las incorrectas: cuando el trabajador falla, tiene que entender por qué. Ahí es donde de verdad aprende.
- Los distractores son **errores reales** que se cometen ("el calor de la freidora destruye el alérgeno"), no opciones absurdas de relleno.

## 5.bis TAXONOMÍA DEL CATÁLOGO (obligatoria en todo curso nuevo)

Con 30+ cursos, un listado plano es inmanejable. Todo curso se clasifica por **tres ejes independientes**. Son campos, no carpetas: un curso puede filtrarse por cualquiera de ellos.

### Eje 1 — CATEGORÍA (`course.category`)
De qué trata. Define dónde aparece en el catálogo.

| Código | Categoría | Contenido |
|---|---|---|
| `cumplimiento` | Cumplimiento legal | Los 9 obligatorios: alérgenos, manipulador, APPCC, igualdad, LGTBI, RGPD, canal, primeros auxilios, PRL |
| `cocina` | Operación de cocina | Mermas, escandallo, inventario, recepción, conservación, limpieza |
| `delivery` | Reparto y delivery | Embolsado, temperatura en ruta, incidencias, KDS |
| `sala` | Sala y cliente | Atención, quejas, upselling, TPV, bebidas |
| `equipo` | Equipo y mandos | Onboarding, dar el pase, liderazgo de turno, cuadrante |
| `producto` | Producto y recetas | Cursos del cliente: smash, milanesa, montaje de combos |
| `sostenibilidad` | Sostenibilidad | Residuos, energía, Ley 1/2025 de desperdicio |

### Eje 2 — TIPO DE NEGOCIO (`course.business_types text[]`)
A quién le sirve. **Un curso solo aparece en el catálogo de las cuentas cuyo `accounts.business_type` esté en su lista.** Vacío o `{todos}` = aplica a cualquiera.

Valores: `restaurante` · `bar_cafeteria` · `dark_kitchen` · `delivery` · `hotel` · `cadena` · `catering` · `todos`

Ejemplos:
- Alérgenos, manipulador, APPCC, RGPD → `{todos}` (la ley no distingue)
- Embolsado y temperatura en ruta → `{dark_kitchen, delivery, restaurante}`
- Servicio de bebidas y ley del alcohol → `{bar_cafeteria, restaurante, hotel}`
- Liderazgo de turno → `{cadena, hotel, restaurante}`

⚠️ **Nunca filtrar por tipo de negocio un curso de cumplimiento legal.** Si la ley obliga, obliga a todos: ocultarlo por tipo de negocio dejaría a un cliente descubierto. Ante la duda, `{todos}`.

### Eje 3 — NIVEL (`course.level`)
A quién va dirigido dentro del local.

`base` (toda la plantilla) · `especialista` (un puesto concreto) · `mando` (encargados, jefes de partida, dirección)

### Y además: ORDEN DE RECOMENDACIÓN (`course.recommended_order`)
Entero que ordena el itinerario sugerido a un empleado nuevo. Manipulador y alérgenos van primero (10, 20); el resto detrás. No es obligatorio hacerlos en orden, pero el portal los presenta así.

### Regla de oro
**Ningún curso nuevo se siembra sin `category` y sin `business_types`.** Un curso sin clasificar se pierde en el catálogo y no lo encuentra nadie.

## 6. FUENTES: de dónde sale el contenido

**Nunca se redacta de memoria.** Cada curso parte de la fuente oficial y **cita sus fuentes al final**. Eso permite verificarlo y, ante un inspector, demuestra que el contenido tiene respaldo.

| Curso | Fuente oficial de referencia | Reeval. |
|---|---|---|
| Higiene / manipulador | AESAN · RD 109/2010 · Reg. CE 852/2004 Anexo II | 48 m |
| Alérgenos e intolerancias | Reg. UE 1169/2011 · RD 126/2015 · AESAN | 12 m |
| APPCC y prerrequisitos | AESAN · guías de prácticas correctas de higiene | 12 m |
| Protección de datos (RGPD) | **Guía AEPD "Protección de datos y relaciones laborales"** | **12 m** ⚠️ |
| Igualdad y acoso | LO 3/2007 · RD 901/2020 · Ministerio de Igualdad | 24 m |
| LGTBI | Ley 4/2023 · RD 1026/2024 | 24 m |
| Canal de denuncias | Ley 2/2023 | 24 m |
| PRL | INSST — **Folvy NO imparte** (solo archivo) | según SPA |
| Primeros auxilios / DESA | recomendado | 24 m |

⚠️ **RGPD a 12 meses**: la AEPD recomienda periodicidad **mínima anual**, alineada con los tratamientos reales de la empresa y **documentada de forma que pueda acreditarse ante la autoridad de control**. (Es exactamente lo que hace Folvy: formación + evidencia firmada + reevaluación.)

**El bloque legal-laboral requiere revisión humana adicional.** No es lo mismo equivocarse en una temperatura que en un protocolo de acoso. Esos cuatro cursos los revisa Julio y, preferiblemente, un asesor laboral antes de publicarse.

## 7. PUBLICACIÓN: draft → revisión → published

- Todo curso nuevo se siembra en **`status = 'draft'`**.
- Pasa a `published` **solo tras revisión humana**. El certificado lo firma el responsable de formación de la empresa cliente, no Folvy: el contenido tiene que estar validado.
- Si se corrige un curso ya publicado, **sube `version`**. Las firmas ya emitidas guardan `course_version`, así que cada acta sigue diciendo qué versión firmó esa persona.

## 8. CHECKLIST antes de dar un curso por terminado

- [ ] 5-7 secciones, cada una con el molde completo (título llano · porqué · imagen · caso real · recuadro técnico)
- [ ] Se completa en 15-30 minutos
- [ ] Cada sección tiene imagen asignada, y es del tipo correcto según el punto 4
- [ ] 10 preguntas **situacionales**, 4 opciones, 1 correcta, con explicación en todas
- [ ] **Posición de las correctas variada** (verificado, no supuesto)
- [ ] Bloque de fuentes al final, con referencias concretas
- [ ] `reeval_months` acorde a la tabla del punto 6
- [ ] **`category`, `business_types`, `level` y `recommended_order` asignados** (§5.bis)
- [ ] **`requires_practical` decidido**: si el curso enseña un GESTO (no solo un concepto), debe llevar verificación práctica con sus items observables
- [ ] Sembrado en `draft`
- [ ] Migración idempotente, con guard, UTF-8 sin BOM y LF

---

## 9. ORDEN DE PRODUCCIÓN

**Oleada 1 — sanitaria** (lo que pide la inspección de Sanidad):
1. Alérgenos *(existe; rehacer con este molde)*
2. Manipulador *(curso de referencia)*
3. APPCC y prerrequisitos

**Oleada 2 — legal-laboral** (requiere revisión reforzada):
4. Igualdad y acoso · 5. LGTBI · 6. RGPD · 7. Canal de denuncias

**Oleada 3 — complementaria:**
8. Primeros auxilios / DESA · 9. PRL *(ficha de archivo, no se imparte)*

---

_Guía creada el 03/08/2026 en el frente de Formación C3._
