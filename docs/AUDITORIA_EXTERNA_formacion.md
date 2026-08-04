# AUDITORÍA EXTERNA — Módulo de Formación de Folvy

*Consultor externo (formación/cumplimiento en hostelería + producto SaaS B2B). 04-ago-2026.*
*Fuentes: repo `Llorente29/llorente29-app` @ `ac0ee21` (HEAD, merge #33 "formacion-lanzamiento"), 22 migraciones de formación, frontend en `src/`, 15 docs de diseño en `docs/`, benchmark de competidores verificado en la web.*

> **Nota de honestidad sobre el alcance (léela primero).** No he podido consultar la BBDD de producción en vivo: el entorno de esta auditoría bloquea la salida a `xzmpnchlguibclvxyynt.supabase.co` (proxy 403). Todo lo que sigue está verificado **contra código y datos-como-código** (las migraciones que insertan cursos y definen funciones) y contra los docs, no contra un `SELECT` en producción. Esto **importa mucho** para lo que me pediste — separar "vivo" de "diseñado" — porque, como explico en §2, **el propio repo no registra qué está aplicado** (las 22 cabeceras `-- Aplicada:` están vacías). Donde afirmo "vivo" quiero decir "el código existe, compila y su lógica es la descrita"; donde no puedo mirar la pantalla, lo digo.

---

## 1. VEREDICTO EN 5 LÍNEAS

1. **El contenido y el motor son mejores de lo que esperaba; la venta y la seguridad son peores.** Tienes un LMS de cumplimiento español real (firma identificada, informe de inspección de nivel producto, rigor legal alto) enterrado bajo un empaquetado sin precio y un fallo de aislamiento multi-tenant que, si se despliega tal cual el cliente 2, es un incidente de seguridad, no un bug de UI.
2. **La ventaja que más vendes —"curso desde el escandallo, ningún LMS del mundo puede hacerlo"— hoy es un botón encargado y, según tus propios docs, "declarado y no entregado".** Vendes un empate como victoria en el punto exacto donde el CEO dijo que no lo hicieras.
3. **La consistencia de estado que te reventó una vez sigue estructuralmente rota:** hay **cinco** implementaciones distintas de "¿este curso está vigente/pendiente?" y la "unificación" de la migración de lanzamiento solo junta dos. El móvil del trabajador y el informe de oficina **todavía** pueden discrepar.
4. **Contra el mercado ganas en dos cosas de verdad (evidencia firmada localizada a España + integración con turnos/escandallo) y pierdes en casi todo lo automatizable** (volumen de contenido, vídeo, offline, SCORM, idiomas, madurez del onboarding). Opus Training (Serie B $9M, feb-2026) ya tiene tu "verificación práctica" y va a por este mercado.
5. **Qué está diciendo hoy el producto sin querer:** "somos una demo honesta de 9 empleados". Para venderlo a un grupo de 150 locales hay que arreglar 4 cosas concretas esta semana (§5) antes de enseñar una sola pantalla.

---

## 2. LO QUE ESTÁ REALMENTE VIVO vs LO QUE SOLO ESTÁ DISEÑADO

**Advertencia de método:** las 22 migraciones de formación llevan la cabecera `-- Aplicada:` **vacía** (8 la tienen vacía; 14 ni siquiera la tienen — verificado). Eso viola tu propia regla dura ("todo DDL aplicado → migración con cabecera `Aplicada:`") y significa que **ni el repo ni yo podemos afirmar con certeza qué corre en producción**. Lo de abajo es mi mejor lectura desde el código + lo que los docs confiesan.

### Construido y (con alta probabilidad) funcionando — verificado en código
- **Motor curso → test → firma → acta** (`20260806T1500_formacion_c1.sql`). Intentos y firmas *append-only* reales, firma solo sobre intento aprobado, identidad resuelta server-side por `auth.uid()`. Sólido.
- **Player del trabajador** con teoría → test 1-pregunta-por-pantalla → firma en canvas → diploma (`src/pages/trabajador/MiFormacion.tsx`). Muestra **solo la fase activa** (`groupActivePhase`, líneas 89-104): el modelo de fases *sí* está implementado en el front.
- **Informe de inspección PDF + Excel** (`trainingCompliancePdfService.ts`, `...Excel...`). Es la pieza más pulida del módulo: cabecera con razón social/CIF, matriz por local, anexo con la imagen de cada firma + DNI + sello de tiempo, "huecos declarados" sin esconder. **Plantable ante un inspector** (con dos bugs, §3).
- **Catálogo del gestor en 3 zonas + editor + asignación + adopción de plantillas globales** (`src/pages/CoursesPage.tsx`). Completo.
- **Verificación práctica en el puesto** (`verify_practical_items`, `VerifyPracticalModal`): el servidor rechaza la autoverificación. Existe de punta a punta.
- **~18-19 cursos didácticos sembrados** (cocina, delivery, cumplimiento legal). El contenido está escrito y es bueno (§ contenido).

### Construido pero NO verificado en pantalla (código existe, nadie garantiza el resultado)
- **Modelo de fases + liberación automática + campañas + cron de desfase** (`20260812T1000_formacion_fases_nucleo.sql`, `20260813T1000_formacion_lanzamiento.sql`). El código está en el merge #33 de HOY. Pero: cabeceras `Aplicada:` vacías, y tu propio historial dice que "verificado" ha significado "mergeado" más de una vez. **Trátalo como no verificado hasta ver la pantalla de un empleado real.** *(NOTA POSTERIOR: la captura de "Mi formación" del trabajador confirma que esto está VIVO — ver anexo de diseño: el trabajador ve 1 fase de 2 cursos, no 13 de golpe.)*
- **Generación de curso desde escandallo** (`generate_course_from_recipe`, `20260810T1200_formacion_c7...`). El código existe. Pero el doc `ENCARGO_CODE_formacion_c7` la describe como reencargo de una pieza "**declarada y no entregada**". No la vendas hasta ejecutarla contra una receta real y firmar el resultado.

### Diseñado, NO construido (vive en un documento)
- **Reevaluación / recertificación periódica.** No existe en el repo ni un solo productor de asignaciones `origin='reeval_periodica'` (el valor está en el CHECK de `course_assignment` y nada lo inserta). El manipulador caduca y **nadie lo vuelve a asignar**. `catalogo_v2 §10` lo admite: "sigue sin construir".
- **Ciclo cerrado APPCC** (auditoría fallida → reformación). `catalogo_v2 §10`: "sigue sin construir" — y sin embargo el §0 del mismo doc dice "**ya golea a Flow Learning en ciclo cerrado con el APPCC**". Es la contradicción más pura del corpus.
- **22 de los 31 cursos** del "catálogo v2" (sala completa, equipo, sostenibilidad). Diseñados en tabla, no escritos.
- **Multi-idioma, calendario de recordatorios/escalado, aviso de caducidad 60/30/7, tiempo de formación → cuadrante.** Encargos o párrafos, no código entregado.

### El "13 cursos con fechas de 2025": ¿resuelto?
El fix está **diseñado y codificado** (`training_path_progress`, `due_at = released_at + días`, backfill que recalcula) **y la captura del trabajador confirma que se ve bien en producción** (1 fase, 2 cursos, sin fechas de 2025). Pero:
- Queda una **reproducción parcial no intencionada:** los ítems de la fase `dia_1` tienen `days_from_hire = 0` → el `due_at` de la fase 1 = instante de liberación → **vencida en el mismo día en que se libera** (la captura muestra "Antes del 4/8/2026" = hoy). No verás "fechas de 2025", pero la fase 1 nace venciendo hoy. Dar unos días de margen.

---

## 3. LAS 5 COSAS QUE MÁS ME PREOCUPAN (por gravedad)

### 🔴 #1 — Fuga multi-tenant: funciones de formación ejecutables por cualquiera, incluida la anon key pública
**Evidencia (verificada de primera mano):**
- El baseline concede por defecto **todo** sobre las funciones nuevas a `anon` y `authenticated`:
  `supabase/migrations/00000000000000_baseline.sql`: `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO "anon";` y `... TO "authenticated";`.
- **Ninguna** migración de formación hace `REVOKE` (grep sobre las 22 = 0). El patrón correcto existe en tu repo (`20260602T2200_connector_secret_functions.sql` revoca), pero aquí no se aplicó.
- Varias funciones `SECURITY DEFINER` **no llevan guard `belongs_to_account`** y aceptan `p_employee_id`/`p_account_id` del cliente: `release_specific_phase`, `ensure_training_path_progress`, `sync_phase_assignments`, `adopt_mandatory_courses(p_account_id)`, `check_phase_completion_for_assignment`, `release_overdue_phases`, `course_state_for_employee(...)`. Y `assign_onboarding_training(uuid)` tiene **GRANT explícito a `authenticated`** (`20260811T1000...:184`) con cero comprobación de permisos.

**Escenario de fallo:** con la anon key —que va en el bundle del navegador, es pública por diseño— un `POST /rest/v1/rpc/course_state_for_employee` deja **leer el estado formativo de empleados de cualquier cuenta**; `release_specific_phase` / `adopt_mandatory_courses` dejan **escribir** en cuentas ajenas. Es exactamente la clase de fallo (`belongs_to_account` omitido) que ya te pasó dos veces (`_kitchen_day_banner_for`, `warehouse_reliability_queue`) y que tu propio `folvy_reglas.md §2` marca como no negociable. Con un solo cliente no explota; **el día que entra el cliente 2 es una fuga entre inquilinos.** Esto es bloqueante para admitir cliente 2.

### 🔴 #2 — Sigue habiendo 5 definiciones de "vigente/pendiente"; el móvil y el informe pueden mentir distinto
**Evidencia:** la lógica de "¿qué cursos tiene pendientes/caducados un empleado?" está duplicada en (1) `course_state_for_employee` (la canónica), (2) el lateral interno de `training_compliance_matrix`, (3) `training_gaps` entera, (4) `my_pending_courses` entera, (5) `training_course_summary` (variante por EXISTS histórico). La "Pieza D" de `20260813T1000` solo hace que 2 consumidores llamen a la canónica. Divergencias vivas concretas:
- **`my_pending_courses` no filtra `course.status = 'published'`** (verificado: grep sobre `20260812T1000_formacion_fases_nucleo.sql` no encuentra el filtro). Un curso en *draft* asignado **aparece y es realizable en el móvil**, pero es **invisible** en el informe de oficina (que sí filtra `published`). El trabajo del empleado no computa en inspección.
- **`my_pending_courses` trata `firmado` como estado terminal**: no mira `reeval_months`. Un manipulador caducado sale **`caducado` en el informe** y **`firmado` (verde) en el móvil del empleado, para siempre**.
- **`training_course_summary`** calcula cumplimiento por "existió alguna vez un intento aprobado", sin caducidad ni práctica → puede dar **100% con todo caducado**, y alimenta la ficha por curso del PDF de inspección.

Es el mismo mecanismo (dos copias, una se corrige y la otra no) que provocó el bug real de "un curso empezado desaparecía del contador". No está cerrado; está parcheado.

### 🔴 #3 — La evidencia legal no es tan robusta como tus comentarios afirman
**Evidencia:**
- `course_signature` tiene columnas `ip` y `user_agent`, pero **el INSERT nunca las rellena** (verificado: `20260806T1500_formacion_c1.sql:772-778` no las incluye; siempre NULL).
- **No se guarda hash** del contenido firmado. Solo un entero `course_version`.
- **El contenido de la versión firmada es destruible:** `generate_course_from_recipe` hace `DELETE` de secciones y preguntas al regenerar. El comentario de C1 ("el acta sigue diciendo qué firmó exactamente") **no se sostiene**: queda el número de versión, no el contenido reconstruible.
- El PDF de inspección **mislabela celdas como personas**: imprime `"{vigente} de {applicable}" + "trabajadores con la formación obligatoria vigente"`, pero cuenta **celdas empleado×curso**, no trabajadores (`trainingCompliancePdfService.ts:179-181` sobre `computeMandatoryCompliancePct`). Con 20 empleados y 5 obligatorias puede decir "83 de 100 trabajadores" en la portada del documento que enseñas al inspector. Eso no es un bug cosmético: es un dato falso en un documento legal.

Como evidencia de "este empleado, con su sesión, aprobó y firmó la versión N tal día" es **mejor que la media del sector**. Como prueba pericialmente robusta (integridad de contenido, IP, hash) **no** está al nivel que el propio código promete. Declara la deuda; no la vendas como fortaleza.

### 🟠 #4 — El test es adivinable de forma medible, y hay un curso viejo publicado que se aprueba sin leer
**Evidencia (verificada en las migraciones de contenido):**
- Los 18 cursos didácticos usan una **plantilla fija** de posición de la respuesta correcta (2 A / 3 B / 3 C / 2 D, o variante). Distribución global de 180 preguntas: **A=40, B=54, C=50, D=36**. Marcar siempre "B" o "C" bate al 25% aleatorio de forma sistemática.
- **Tres cursos comparten la clave de respuestas idéntica** (`igualdad_acoso`, `primeros_auxilios`, `embolsado_delivery`): quien memorice la secuencia de uno aprueba los otros dos sin leer.
- **El seed viejo `20260806T1600_seed_curso_alergenos.sql` sigue en el repo, sembrado como `published`, con un test de pura memoria y clave `b c b c b c b b b b`** (7 B, 3 C, cero A/D): se aprueba marcando siempre "B". Convive como fichero con la versión didáctica buena; en cualquier despliegue parcial/rollback, la versión adivinable es la que queda publicada.
- Tell adicional: **la opción correcta suele ser la más larga y matizada** (manipulador Q8, embolsado Q4, KDS Q6…). Un alumno espabilado lo explota.

Para un módulo cuyo argumento de venta es "evidencia de que el empleado *sabe*", un test que se aprueba por heurística de examen es una grieta en la propuesta de valor.

### 🟠 #5 — Encuadre legal "obligatorio" falso para tu propio cliente, y huecos de catálogo que la propia guía promete
**Evidencia:**
- El rigor legal de fondo es **alto** (RD 109/2010 sobre el carnet: correcto; los 14 alérgenos: completos; temperaturas de zona de peligro **consistentes entre todos los cursos** —raro y meritorio—; RCP/Heimlich actuales y seguros; RGPD, Ley 2/2023 y RD 901/2020 bien distinguidos). **No encontré ningún error legal grave.** Crédito donde toca.
- **Pero** los cursos de **LGTBI** y **Canal de denuncias** llevan en el summary "Obligatorio en empresas de más de 50 personas" / "de 50 o más". Llorente29 tiene **9 empleados**: esos cursos **no son legalmente obligatorios** para tu cliente activo. El texto interno lo matiza bien, pero el encuadre de portada afirma una obligación que no existe. Si un cliente pequeño lo cree, le estás vendiendo miedo.
- **Falta la categoría `sala` entera** (atención al cliente, quejas presenciales, upselling, bebidas/alcohol a menores) que tu propia `folvy_formacion_guia_contenido.md §5.bis` promete. Faltan también seguridad vial de repartidores (si hay reparto propio) y el recalentado ≥70 °C explícito en el manipulador.

---

## 4. CONTRA EL MERCADO — ¿ventaja real o empate vendido como victoria?

Aplico tu regla: *ganar de forma decisiva, o declarar la deuda.*

| Lo que crees que ganas | Veredicto honesto | ¿Cuánto tarda un rival financiado en copiarlo? |
|---|---|---|
| **Evidencia firmada localizada a España** (firma + DNI + `auth.uid()` + informe de inspección con base legal AESAN/APPCC) | **VENTAJA REAL, pero estrecha.** Es lo que exige de verdad una inspección (plan documentado + registros por empleado; no hay carnet oficial desde 2010). Trainual ya tiene e-firma; nadie más tiene el informe con marco legal español. | 2-4 meses-persona de ingeniería + 1-2 de conocimiento normativo. **Foso bajo.** |
| **Verificación práctica en el puesto por el encargado** | **EMPATE, no ventaja.** **Opus Training ya la tiene** (evaluaciones presenciales por el mánager). Es tu feature, ya copiada por el rival que viene a por este mercado. | Ya hecha por Opus; 2-3 MP para el resto. **Decláralo empate.** |
| **Ciclo cerrado con APPCC** | **NO EXISTE (deuda, no ventaja).** Tú mismo lo admites en `catalogo_v2 §10`. Vender "golea a Flow en ciclo APPCC" es vender un empate —peor, una ausencia— como victoria. | N/A hasta construirlo. |
| **Curso desde el escandallo** | **VENTAJA POTENCIAL REAL y ÚNICA — pero no entregada.** Verifiqué el mercado: **nadie** genera curso+test+evidencia desde la receta (meez convierte recetas en material sin quiz; GastroKaizen tiene escandallos y academia sin conectar; Opus genera con IA desde documentos, no desde tu escandallo). El foso no es la IA, son **los datos**: tener escandallo+POS+turnos en la misma base. | LMS puro: 6-12 MP + adquirir un sistema de recetas. Mapal (ya tiene suite): 3-6 MP. **Foso medio — si lo entregas.** |
| **Semáforo formación en el cuadrante de turnos** | **VENTAJA REAL y poco copiable — si está construido.** Nadie lo hace: los schedulers (Skello, Combo, 7shifts) no tienen LMS; los LMS no tienen turnos; solo Mapal tiene ambos módulos y **no los ha conectado** (verificado en su web). | Solo Mapal puede a corto plazo: 2-4 MP. Para el resto, 4-8 MP vía integración. **Vigila a Mapal.** |

**Dónde pierdes y no lo dices en el benchmark interno:** SCORM/xAPI (no puedes importar el contenido corporativo de un grupo de 150 locales — justo tu comprador objetivo), **vídeo** (formas con markdown; Typsy tiene 2.000+ lecciones en vídeo), **offline y app nativa de LMS** (eres un portal web por QR), **volumen** (ofreces ~1 curso revisado de verdad frente a librerías de 1.000+), **idiomas** (tu plantilla "no siempre castellanoparlante" — Opus auto-traduce a 100+ idiomas por SMS, tú a 1).

**La amenaza estructural** no es una feature: es **Mapal/Flow Learning**, el único que ya tiene formación + workforce en la misma casa y en español. La señal a vigilar es el día que conecte Flow Learning con su módulo Workforce. **Opus** es la amenaza de modelo (frontline-first, SMS, IA, Serie B reciente), pero sin España ni contenido normativo español todavía.

**Tu foso verdadero, dicho sin autoengaño:** no es ningún curso ni ninguna firma. Es que el escandallo, el POS, el cuadrante y la formación viven en **la misma base multi-tenant, en español, ya dentro del local**. Esa es la frase de venta. Todo lo demás es copiable en trimestres.

### Empaquetado y precio
**No existe un precio en ningún documento.** Lo único escrito es "módulo compartido Team↔Safety, pago extra". Has desplegado en un cliente un módulo "de pago extra" sin tier, sin modelo (por local / por asiento / plano) y sin cifra. Referencias de mercado para calibrar: Opus y Mapal cobran **por local** (no publican precio); Typsy $120/miembro/año; 7shifts $40-135/local/mes. **Recomendación:** cóbralo **por local/mes** (coherente con tu cliente objetivo y con cómo compra la hostelería), no por asiento —la rotación alta castiga el por-asiento—, y ancla el precio al dolor real: "una inspección con la formación en regla" y "cero horas de gestor montando formación". Un rango defendible hoy: **20-40 €/local/mes** como add-on, revisable cuando el catálogo pase de ~9 cursos reales a ~30.

---

## 5. IMAGEN Y VENTA — qué cambiaría y por qué (concreto)

**¿Aguanta una demo ante el CEO de un grupo de 150 locales? Hoy, no del todo. Cuatro cosas chirrían y tres son de 10 minutos de arreglo:**

1. **Cambia dos fotos de portada YA.** `public/formacion/portadas/estacion_kds.jpg` es una foto stock donde la pantalla KDS muestra **una UI ajena en inglés** ("Finish/Cancel", "Shark fin soup") — en un producto cuyo KDS *es* Folvy. Y `igualdad.jpg` muestra un equipo con **gorras de marcas reales (Rip Curl)** y temáticamente dice "gente contenta", no "igualdad y acoso". Son lo primero que ve un CEO. (Las otras dos fotos, `embolsado.jpg` y `temperatura_ruta.jpg`, son stock anónimo correcto.)

2. **La mezcla SVG propio + 4 fotos: funciona, pero tiene dos costes ocultos.** Los 13 SVG son una familia visual homogénea y digna (mismo lienzo, misma paleta navy/terracota) — no parece apaño *entre ellos*. El apaño se nota solo en las 2 fotos malas del punto 1. **Dos avisos:** (a) **todos los SVG llevan el texto embebido** ("LOS 14 ALÉRGENOS", etc.) → el día que hagas multi-idioma hay que **redibujar 19 ficheros**; (b) hay 4 SVG muertos (`embolsado.svg`, `estacion_kds.svg`, `igualdad.svg`, `temperatura_ruta.svg`) que ya nadie referencia, desplegados en producción.

3. **Arregla el "N de M trabajadores" del PDF (§3-#3) antes de enseñar el informe.** Es tu mejor pieza comercial y ahora mismo puede imprimir un número imposible ("83 de 100 trabajadores") en la portada. Un CEO que audita lo detecta.

4. **Registra el permiso `show_formacion`.** El ítem de menú "Formación" en Personal exige un permiso que **no existe** en `managerPermissionsService.ts` ni en migraciones (grep vacío) y `hasPermission` es fail-closed → **ningún manager puede ver Formación nunca**, solo admins. En una demo con perfiles de encargado, el módulo *desaparece*.

**Qué capturas irían a la web comercial (y cuáles no):**
- **SÍ:** el PDF de inspección (con el bug arreglado) — es tu activo. La pantalla del trabajador con una sola fase y barra "3 de 5". El catálogo del gestor en 3 zonas. El semáforo en el cuadrante (**solo si confirmas que está vivo**).
- **NO (todavía):** cualquier captura con las 2 fotos malas; la matriz de cumplimiento con "0·0·0·0 · 100%" de una cuenta vacía; el Excel con celdas `undefined` (`trainingComplianceExcelService.ts` no etiqueta `pendiente_practica`).

**El pitch de 30 segundos que yo daría a ese CEO:**
> "Tus 150 locales tienen la formación de tu gente y su escandallo en dos sitios distintos, y cuando entra Sanidad rezas. Folvy los junta: el curso de alérgenos nace de tu propia ficha de producto, el empleado lo firma con su DNI desde el móvil, y si le falta la formación obligatoria **no puede entrar al turno**. Cuando llega la inspección, sacas un PDF con cada firma fechada. No es un LMS que además vende hostelería; es tu operación, que además forma."

**Lo que el producto está diciendo hoy sin querer:** "somos una demo de 9 empleados hecha en una semana" — por las 2 fotos, el "100% verde" de cuenta vacía, el precio ausente y el "obligatorio" falso para pymes. Todo eso es arreglable en días; el mensaje potencial es fuerte.

---

## 6. QUÉ HARÍA ESTA SEMANA (si fuera el responsable de producto)

En orden. Las tres primeras son de seguridad/verdad y bloquean vender; las demás son de imagen.

1. **Cerrar la fuga multi-tenant (§3-#1). Bloqueante para cliente 2.** `REVOKE EXECUTE ... FROM anon, authenticated` en todas las funciones de formación + añadir guard `belongs_to_account`/permiso a `release_specific_phase`, `adopt_mandatory_courses`, `course_state_for_employee`, `assign_onboarding_training`, `ensure_/sync_/check_/release_overdue`. Verificar con una llamada real usando la anon key.
2. **Verificar en pantalla, con un empleado real, que el fix de fases está VIVO** (confirmado en la captura de Mi Formación) y que la fase `dia_1` con `days_from_hire=0` no dispara la cascada del cron ni vence "hoy". Rellenar las 22 cabeceras `-- Aplicada:`.
3. **Unificar de verdad la vigencia (§3-#2):** que `my_pending_courses`, `training_gaps` y `training_course_summary` llamen a `course_state_for_employee`; añadir el filtro `status='published'` al móvil; que `firmado` respete `reeval_months`. Arreglar el "N de M trabajadores" del PDF y el `undefined` del Excel.
4. **Contenido:** neutralizar el seed viejo de alérgenos (`20260806T1600`); aleatorizar de verdad la posición de la correcta y romper las 3 claves idénticas; corregir el summary "obligatorio" de LGTBI y Canal de denuncias para <50. Barajar opciones en render por usuario si da tiempo.
5. **Imagen:** sustituir `estacion_kds.jpg` e `igualdad.jpg`; borrar los 4 SVG muertos; registrar `show_formacion`; poner una capa "sin datos aún" en la matriz para que una cuenta vacía no muestre "100% verde".
6. **Negocio:** decidir precio (por local/mes) y escribirlo. Y decidir la narrativa: dejar de vender "ciclo APPCC" y "curso desde escandallo" como hechos hasta que uno de los dos esté verificado end-to-end contra datos reales — y entonces vender **ese**, que es el único foso que el mercado no tiene.

---

### Anexo — qué verifiqué de primera mano vs qué proviene de lectura de código/docs
- **De primera mano (grep/lectura directa del repo):** ausencia de `REVOKE` en las 22 migraciones; `GRANT ... TO authenticated` en `assign_onboarding_training`; baseline `GRANT ALL ON FUNCTIONS TO anon/authenticated`; `ip`/`user_agent` ausentes del INSERT de firma; `my_pending_courses` sin filtro `published`; cabeceras `Aplicada:` vacías; existencia de los ficheros de contenido y de fases.
- **De lectura analítica (mía + subagentes), no ejecutado en BBDD viva:** el conteo A/B/C/D de las 180 preguntas y las 3 claves idénticas; las 5 implementaciones de vigencia y sus divergencias exactas; el rigor legal afirmación-por-afirmación; el benchmark de precios de competidores (verificado en la web, con URLs).
- **NO verificado (sin acceso a producción):** número real de cursos publicados vs draft, nº de empleados con formación bloqueante pendiente hoy, y si las 4 funciones de estado devuelven lo mismo **en datos reales** (analicé su *código*, no su *salida*). Para cerrar esto hace falta un `SELECT` en el SQL Editor — te dejo las queries si quieres.
