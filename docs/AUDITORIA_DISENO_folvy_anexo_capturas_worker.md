# ANEXO B — Auditoría de diseño Folvy · capturas de trabajador y Pedidos

*Complemento al informe `AUDITORIA_DISENO_folvy.md`. 04-ago-2026.*
*Nuevo material recibido: 5 capturas — Pedidos (tablero), Home del empleado (móvil), Mi Portal, Mi Formación, Mi Horario.*

> Estas capturas cubren el **portal del trabajador** y el **tablero de Pedidos**. Siguen faltando (las pido de nuevo abajo): el **terminal KDS de cocina** (`/cocina-tv`), la **app de repartidor**, la **tablet de estación** (86/disponibilidad) y la **tienda cara-al-cliente**. Aviso además de que el portal del trabajador aparece capturado en **ventana ancha de escritorio**; en un teléfono real se vería más compacto, así que juzgo IA/copia/jerarquía (fiables a cualquier ancho) y me abstengo del veredicto de densidad-en-mano.

---

## Lo que estas capturas CONFIRMAN (buenas noticias)

**1. El fix del "13 cursos de golpe" está vivo y se ve bien.** *(Captura: Mi Formación.)* El trabajador ve **una sola fase — "Para poder empezar a trabajar · 2 cursos · 55 min · Progreso 0 de 2"** con exactamente dos cursos ("Gestión de alérgenos…" En curso; "Higiene alimentaria — manipulador…" Pendiente). No hay lista de 13, no hay fechas de 2025, hay jerarquía. **Esto es lo que se pedía y está conseguido.** Es, además, una pantalla que vende (fases + progreso + minutos).

**2. El portal del trabajador es de los mejores rincones del producto.** *(Capturas: Home, Mi Portal, Mi Horario.)* Saludo humano ("Buenas noches, Pamela"), jornada en curso con cronómetro grande "2h 49m", acción primaria "Fichar salida" clarísima, lista tipo ajustes-de-iOS legible (Mi horario, Turnos abiertos, Cambios de turno, Mis fichajes, Mi formación, Mis documentos, Mis vacaciones), y **copy honesto** donde toca: *"El horario de esta semana está en borrador. Tu encargado lo está preparando."* / *"Tienes una jornada abierta."* Para una plantilla joven y de alta rotación, esta simplicidad task-first está **por encima del mercado**, no en empate.

**3. El tablero de Pedidos es sólido operativamente.** *(Captura: Pedidos.)* Banda de KPI muy vendible — *"Media de hoy: 16 min · 28 pedidos · objetivo 15 min · 1 min por encima"* —, temporizadores por tarjeta con punto rojo, badge de plataforma (Glovo), estado "Aceptado", "Repartidor asignado" + "Llamar", y la acción "Listo" en acento. Denso pero legible.

---

## Tells NUEVOS que estas capturas revelan (y hay que corregir)

**B1 — 🔴 Los alérgenos salen en INGLÉS en el tablero de cocina. *(Pedidos. Problema REAL de uso + demo. 10 min.)*** Los chips dicen **`gluten` · `eggs` · `milk`**. Es la información **más crítica para seguridad** de toda la pantalla, la lee el cocinero con prisa, y está en el idioma equivocado para una plantilla española ("eggs"/"milk" en vez de "huevo"/"leche"). Un inspector o un CEO lo ve al instante. Traducir el diccionario de alérgenos a es-ES: media hora, impacto alto. *(Conecta con la ausencia total de i18n que ya señalé — pero esto no puede esperar a un proyecto de idiomas.)*

**B2 — Separador decimal con PUNTO otra vez, ahora en horas. *(Mi Horario. Percepción. 10 min.)*** "Total horas semana **40.5h**", "**8.75h**", "**4.50h**" vs "**4.5h**" — punto en vez de coma es-ES, **y** inconsistencia de ceros (`4.50h` junto a `4.5h`). Es el **segundo módulo** donde aparece el problema de formato numérico (el primero fue `15.22%` en la ficha de escandallo): confirma que es **sistémico**, no un despiste. Un único helper `formatEsES` aplicado en horas, precios y porcentajes lo cierra de una vez.

**B3 — IDs crudos de plataforma como ruido. *(Pedidos. Percepción. 10 min.)*** Cada tarjeta muestra el identificador largo de Glovo (`181734005396`) junto al código corto (`#9C4AE`). El número largo no le sirve a nadie en cocina y ensucia la tarjeta. Ocultarlo o moverlo a un "detalle".

**B4 — Confirmación parcial del roce de fechas del onboarding. *(Mi Formación. Real, menor. 1 día.)*** Los dos cursos de la fase 1 vencen **"Antes del 4/8/2026"** — es decir, **hoy mismo**, el día del alta/liberación. Es exactamente el efecto que anticipé desde el código (fase `dia_1` con `days_from_hire=0` → vence el día que se libera). No es el desastre de las fechas de 2025, pero "haz 55 min de curso antes de que acabe hoy" es innecesariamente agresivo para el primer día. Dar unos días de margen a la fase 1.

---

## Veredicto actualizado

Con el portal del trabajador y Pedidos a la vista, **subo la nota, no la bajo**: la mitad "manos ocupadas" que yo tenía a ciegas resulta ser, en su cara de *portal*, una de las más cuidadas del producto (task-first, copy honesto, el modelo de fases funcionando). Los defectos nuevos son **puntuales y baratos** (alérgenos en inglés, decimales con punto, IDs crudos) salvo la deuda de i18n de fondo, que sigue siendo el mayor hueco estratégico para tu plantilla no castellanoparlante.

**Lo que sigo SIN poder juzgar** (y donde de verdad se decide tu diferenciación en cocina): el **terminal KDS a pantalla completa** (`/cocina-tv`), la **app del repartidor**, la **tablet de estación**, y la **tienda del comensal**. De estas, el código me preocupa solo en el KDS (botón "Listo"/bump ~24px, por debajo del mínimo táctil de 44px). Con una captura de cada una cierro el informe entero.

**Añadidos al plan de la semana (todos de 10 min salvo B4):** traducir alérgenos a es-ES (B1, prioritario por seguridad), helper único de formato numérico es-ES aplicado a horas/precios/porcentajes (B2), ocultar IDs de plataforma en las tarjetas (B3), y dar margen a la fase 1 del onboarding (B4, 1 día).
