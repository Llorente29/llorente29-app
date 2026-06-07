# Folvy — Guion vivo de trabajo

**El documento que decide qué hacer ahora.** No es una lista de tareas: es una secuencia ordenada por **efectividad comercial**, que se reordena con cada avance. Cuando abras una sesión, este documento te dice el siguiente frente sin que tengas que decidir.

> **Última actualización**: 7 jun 2026.
> **Cómo se usa**: el frente activo es el primero de la lista "AHORA". Al cerrarlo, se mueve a "HECHO" y sube el siguiente.
> **Cómo se mantiene**: el ritual de cierre de sesión (ver `folvy_cierre_sesion.md`) actualiza este documento SIEMPRE.

---

## La cadena comercial (por qué este orden)

Los cuatro objetivos comerciales no son cuatro caminos, son una cadena donde cada eslabón desbloquea el siguiente:

**Llorente29 en producción → es la demo real que cierra ventas → demuestra que el MVP funciona solo → habilita captar clientes de pago.**

Por eso el guion prioriza, en cada momento: *lo que más acerca a tener Llorente29 operando 100% en Folvy*, porque eso dispara todo lo demás. Un frente que no acerca a producción (por bonito que sea técnicamente) baja en la lista.

## Cómo se puntúa cada frente (efectividad comercial)

Cada frente lleva una etiqueta de impacto, de mayor a menor:
- **🔴 BLOQUEA PRODUCCIÓN** — sin esto Llorente29 no puede operar en Folvy. Máxima prioridad.
- **🟠 DESBLOQUEA DEMO** — hace la demo creíble/vendible a un prospecto.
- **🟡 ESCALA A MVP** — permite que otro hostelero use Folvy sin Julio (onboarding solo).
- **🟢 GOLEA** — diferenciador competitivo (del mapa), sube el valor pero no bloquea.
- **⚪ DEUDA/MANTENIMIENTO** — higiene técnica, seguridad, limpieza. Se intercala, no lidera.

Dentro de cada nivel, ordena: (1) lo que ya está empezado, (2) lo que menos esfuerzo cuesta para más impacto, (3) lo que desbloquea más cosas detrás.

---

## AHORA (el frente activo y los 2-3 siguientes)

### 1. ⚪→🔴 Higiene de seguridad pendiente (intercalar YA, no lidera pero urge)
- Rotar contraseña de tspoon (expuesta en transcript 7 jun).
- Rotar service_role key y tokens de webhook (pegados en chats anteriores).
- **Por qué primero**: riesgo activo. No bloquea producción pero es deuda que crece. 10 minutos.

### 2. 🔴 Recepción — "qué entra al almacén" claro + corrección post-escaneo
- Tras OCR, el usuario debe ver EXACTAMENTE qué entra a stock y poder corregir lo extraño (deuda Julio, 7 jun).
- OCR doble columna (cajas vs contenido): usar `packages` ya capturado, validar por importe, probar varios albaranes reales.
- **Por qué**: la recepción es la puerta del inventario, y el inventario es lo que más usa Llorente29 (510 inv en 2 años). Sin recepción fiable, el inventario perpetuo no arranca. BLOQUEA la cadena de coste real.

### 3. 🔴 Inventario perpetuo (el tronco) + consumo teórico encendible YA
- Construir el inventario perpetuo (memoria #24): inicial + comprado − consumo teórico = teórico; vs conteo = merma.
- Encender consumo teórico vía RPC ventas×escandallo SIN esperar (los datos ya existen) — diferenciador inmediato.
- **Por qué**: es lo que MÁS usa Llorente29 y la bandera del rival serio (R365: AvT). Mapa competitivo Área 4: deuda crítica + oportunidad de goleada (autoinventario IA, merma por diferencia). Núcleo de producción.

### 4. 🟢 Limpieza de catálogo (eliminar/fusionar proveedores e ingredientes)
- Herramienta para limpiar: 611 ingredientes muertos, proveedores duplicados/[Copia], acreedores vs proveedores.
- **Por qué**: dolor masivo real (80% del catálogo es ruido), y es producto para CUALQUIER cliente (escala a MVP). Mapa Área 2.

---

## SIGUIENTE (cuando se libere lo de AHORA)

### 5. 🔴 Migración Llorente29 (poblar la cuenta real desde Folvy Interno)
- Mover el trabajo real (ingredientes, escandallos, ventas) de Folvy Interno (sandbox) a la cuenta Llorente29 vacía.
- **Por qué**: paso físico hacia producción. Bloquea el "operar 100% en Folvy".

### 6. 🟠 Pulido de demo (lo que un prospecto ve primero)
- Responsive/móvil (sidebar no colapsa — requiere permiso App.tsx).
- www.folvy.app DNS (NXDOMAIN).
- Editar perfil propio (nombre).
- **Por qué**: una demo que falla en móvil o en detalles visibles no cierra ventas. DESBLOQUEA DEMO.

### 7. 🟢 Three-way match + factura (cierra el ciclo de coste)
- OCR factura→coste (paso 4), casar pedido↔albarán↔factura.
- **Por qué**: mapa Área 8, deuda que tienen tspoon/R365/Marketman. Sube el valor del producto.

---

## HORIZONTE (importante, aún no toca)

- 🔴 **Verifactu / facturación electrónica** — DEUDA CRÍTICA fiscal (mapa Área 8). Disparador: antes de que un cliente facture desde Folvy. Sin esto se pierden clientes serios.
- 🟢 **IA copiloto en cada módulo** (compras, recepción, inventario) — mapa Área 7, rival R365 AI. Mostrar la IA, no esconderla.
- 🟢 **Unidades de uso amigables** (gestos del cocinero, memoria #5) — diferenciador, mapa Área 1.
- 🟢 **Alérgenos + nutrición auto desde master** (memoria #23) — alcanzar a meez, mapa Área 1.
- 🟢 **Comisiones por canal + margen real** (memoria #3) — golea, nadie lo hace, mapa Área 6.
- 🔵 **Cocina central / producción** — BAJA prioridad (Llorente29 no la usa). Tener con gancho de diseño, no construir aún. Para obrador/catering/cadena.
- 🟢 **Marcas cedidas Cloudtown** (memoria #26) — tras migrar las propias.
- ⚪ **Trazabilidad de lote + FEFO** — mapa Áreas 4/9.
- ⚪ **folvy_mapa_global.md** (diagrama SVG de capas) — al cerrar frente Artículos/Proveedores.

---

## HECHO (para no repetir ni olvidar lo ganado)

- ✅ Folvy Kitchen (escandallos, coste a la décima, recompute cascada).
- ✅ Recipe Steps E8 (pasos enlazados a ingredientes) — diferenciador vs tspoon.
- ✅ Last.app webhook (ventas Glovo/Uber automáticas, 99.3% mapeadas, 12K backfill).
- ✅ Folvy AI v1++ (streaming, ve 3 módulos).
- ✅ APPCC (corrección + foto + notificación) — diferenciador.
- ✅ Supply: pedido sobre catálogo (3 modos, multi-local, PDF, PED-correlativo).
- ✅ Motor de IVA versionado por fecha.
- ✅ Recepción: formatos anidados, precio derivado caja→bote, casado por código, blind receiving, captura packages.
- ✅ Migración tspoon→Folvy (formatos, article_supplier).
- ✅ Web pública folvy.app (7 páginas EN/ES).
- ✅ Auditoría competitiva completa (tspoon a fondo + mapa competitivo mundial).

---

## Regla de oro del guion
**No empieces una sesión preguntándote qué hacer. Abre este documento: el frente 1 de AHORA es lo que toca.** Si algo cambió las prioridades (un cliente, una urgencia), se reordena aquí — pero siempre con la pregunta: *¿qué acerca más a Llorente29 en producción, que es lo que dispara las ventas?*
