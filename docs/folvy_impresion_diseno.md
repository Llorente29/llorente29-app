# Folvy — Diseño de impresión (tickets, comanda y pegatinas)

> **Estado:** DISEÑO APROBADO (maquetas visuales aprobadas por Julio el 19/06/2026).
> Construcción pendiente, por piezas. Este documento es la verdad del frente de
> impresión: qué se imprime, cómo se entrega al papel, y en qué orden se construye.
>
> **Origen:** frente #5 del cierre del módulo Folvy Orders. RECON confirmó greenfield
> (no existe nada de impresión en el repo salvo `ReportPreviewModal` = window.print de
> informes, sin relación). Benchmark: Last (referencia de los 3 documentos), Toast/
> Square/Lightspeed (estándar ESC/POS multi-transporte), Star Micronics (hardware).

---

## 0. Principio rector

La impresión es una **capa agnóstica con adaptadores de transporte**, igual que TPV y
canales en Folvy (frontera única + adaptadores). Folvy decide **QUÉ** imprimir (el
documento, en formato lógico) de forma independiente de **CÓMO** llega físicamente al
papel (el transporte). El estándar universal del contenido es **ESC/POS** (toda
impresora térmica de hostelería lo habla; los POS líderes lo asumen como base).

NO se impone un único transporte. El cliente conecta su impresora como puede/quiere y
Folvy se adapta. Se construye el núcleo agnóstico con UN transporte primero (red por IP)
y la rampa declarada para los demás (CloudPRNT, Bluetooth, USB/agente).

**Goleada sobre la competencia:** los documentos de cocina/pegatina de Last NO llevan
alérgenos. Folvy los tiene de la ficha del escandallo (`recipe_item_allergen`) y los
pinta automáticamente donde corresponde — seguridad alimentaria real sin teclear.

---

## 1. Los tres documentos (maquetas aprobadas)

### 1.1 Ticket de bolsa / cliente
El documento "todo" que acompaña al pedido en la bolsa. Es el fiscal + entrega + económico.
Campos (orden de la maqueta):
- **Logo de la marca** (arriba, centrado). DEPENDENCIA D1 — hoy NO existe logo por marca.
- Razón social + CIF + dirección fiscal (de `accounts`).
- Fecha/hora, "Factura Simplificada" + nº.
- **Código de pedido** en banda negra, grande (p.ej. `G406`).
- Código de plataforma (Glovo/Uber/JE), método, cliente, dirección completa, CP, teléfono.
- **Productos CON precios**, combo desglosado.
- Económico: gastos de envío, desglose de IVA, Total, Pagos.
- **QR a la tienda propia (Folvy Shop)** abajo, protagonista, con **caption configurable
  por el cliente** (`qr_caption` por marca/local; default sensato). DEPENDENCIA D2 (URL shop).

### 1.2 Ticket de cocina
La comanda de producción. **SIN precios, SIN datos fiscales, SIN dirección.**
- TICKET <plataforma> + código de pedido en banda negra grande.
- Marca, código plataforma, fecha, nombre cliente (corto), hora de recogida, método (recuadro).
- **Productos agrupados POR CATEGORÍA DE COCINA** con banda negra (Primeros/Main/Bebidas…),
  combo con sus componentes y modificadores.
- **SIN ALÉRGENOS en el ticket impreso** (decisión de seguridad de Julio): un alérgeno
  suelto en la comanda puede leerse como "el cliente es alérgico, NO lleva esto" cuando
  significa "este plato contiene esto" — ambigüedad peligrosa. Los alérgenos van al
  **Cook Mode** (al pulsar el plato, donde el contexto es inequívoco: composición). El
  ticket lleva solo una nota al pie: "Alérgenos en el escandallo (pulsar el plato)".
- El orden por categoría reusa la lógica del `sort_rank` del feed (#6): bebidas/postres
  al final.

### 1.3 Pegatina por artículo — OPCIÓN (c), agrupación por bolsa
**Decisión firme de Julio (c), "sí o sí":** NO una pegatina ciega por ítem. Lógica de
agrupación por destino de embolsado:
- **Comida:** una pegatina **por artículo** (cada envase su etiqueta).
- **Bebidas y postres:** van SIEMPRE en bolsa aparte → **una pegatina agrupada** que lista
  lo que va en esa bolsa, se pega en la BOLSA (no en la lata). Resuelve "no etiquetar latas".
Campos de la pegatina (sobre 6d del doc KDS: nombre+modificadores+order_code+marca+alérgenos):
- Código de pedido + marca + **icono alegre (moto/scooter)**.
- Nombre del artículo + modificadores.
- **Alérgenos con ICONOS OFICIALES UE** (los 14 pictogramas). DEPENDENCIA D3.
- "N de M" (saber cuántas piezas lleva el pedido al embolsar) + nombre cliente.
- **QR a la shop, pequeño** (cuantos más sitios lo vea el cliente, mejor — Julio).
- La pegatina de bolsa agrupada se distingue visualmente (borde grueso + chip "BOLSA BEBIDAS").

---

## 2. El QR a la tienda propia (estratégico)

No es adorno: **desvía tráfico de Glovo/Uber (comisión ~30%) al canal directo (Folvy Shop,
sin comisión).** El cliente pidió por plataforma, recibe la bolsa, ve el QR → siguiente
pedido directo. Retención + margen. Conecta con el frente **Folvy Shop**.
- **Dónde:** ticket de bolsa (100% seguro, grande) + pegatina (pequeño). "En cualquier
  sitio que se nos ocurra" (Julio) = máxima exposición.
- **Apunta a:** la URL de la shop de esa MARCA/local (DEPENDENCIA D2).
- **Caption:** texto libre configurable por el cliente (`qr_caption`).
- **Generación:** el QR se genera del valor de la URL (no es imagen fija).

---

## 3. Dependencias previas (infra que falta)

- **D1 · Logo por marca.** `brand.logo_url` + bucket + RLS + uploader en la ficha de marca.
  HOY solo existe `accounts.logo_url` (el de la empresa/fiscal). Una marca virtual (Mila's)
  tiene su logo propio, distinto del de Llorente29 Food. Pieza limpia y autocontenida; el
  logo de marca sirve para más que el ticket. **Candidata a primera pieza a construir.**
- **D2 · URL de Folvy Shop por marca/local.** Para que el QR sepa a dónde apuntar. Depende
  del estado de Folvy Shop (canal directo, en estudio). Mientras no haya shop, el QR puede
  apuntar a una landing/placeholder configurable.
- **D3 · Set de iconos oficiales de alérgenos (14 UE).** Para la pegatina. Conseguir el set
  (SVG/PNG) y mapearlo a los `allergen_code` de Folvy.

---

## 4. El núcleo agnóstico

- **N1 · Modelo de datos:**
  - `printer` (por local): transporte, config del transporte (IP/puerto, etc.), qué
    documentos imprime (cocina / pegatinas / bolsa), activa/inactiva, nombre.
  - `print_job` (cola): documento (kind), payload, estado (pending/printing/done/error),
    printer_id, sale_id/line_id, timestamps. Patrón de cola robusto (reintentos).
- **N2 · Renderizador ESC/POS:** genera el ESC/POS de cada documento (bolsa/cocina/pegatina)
  desde el pedido canónico. Incluye: bandas, negritas, tamaños, el QR (comando ESC/POS de QR
  nativo de la impresora), agrupación de pegatinas por bolsa, agrupación de cocina por categoría.
- **N3 · Transporte (adaptadores):**
  - **#1 = RED LOCAL POR IP** (pedido por Julio como primero; estándar pro). MATIZ TÉCNICO
    REAL: el navegador NO abre sockets TCP al puerto 9100 de la impresora → para LAN-por-IP
    hace falta o impresora con **CloudPRNT/WebPRNT** (modelo pull: la impresora pregunta a
    Folvy), o un **agente local** que reciba de Folvy e imprima por IP. A resolver en
    construcción; afecta a la arquitectura del transporte. (Aviso del benchmark: el router
    reasigna IPs → recomendar **IP estática** para la impresora.)
  - **Rampa declarada (siguientes adaptadores):** CloudPRNT (polling, sin tocar la red del
    cliente, multi-local — patrón webhook que ya usamos), Bluetooth (Web Bluetooth, NO va en
    iOS/Safari), USB/local (agente). Cada uno con lo que cubre y sus límites.

---

## 5. Disparadores

- **Automático al servir:** trigger sobre `kds_ticket_station_state` (al bump de la estación
  expo / botón Servir) → encola los print_job correspondientes. MISMO patrón que el puente
  del empuje de hoy (trigger → net.http_post). Configurable: qué se imprime y cuándo.
- **Manual:** botón de imprimir cada documento desde el feed/cocina.
- **Reimpresión:** volver a sacar cualquier documento de un pedido.
- **Config por documento/impresora:** la bolsa no se imprime en la impresora de cocina; las
  pegatinas en la linerless; la comanda en la de cocina. Cada local mapea qué impresora hace qué.

---

## 6. Orden de construcción (de menos a más dependencias)

1. **Maquetas finales** — APROBADAS (este documento las recoge).
2. **D1 · Logo por marca** — pieza limpia, autocontenida, útil más allá del ticket. PRIMERA.
3. **D3 · Iconos de alérgeno UE** + **D2 · URL shop por marca** — infra/datos.
4. **N1/N2 · Núcleo:** modelo `printer`/`print_job` + renderizador ESC/POS de los 3 documentos.
5. **N3 · Transporte por IP** + prueba con impresora real (aquí se decide CloudPRNT/WebPRNT vs agente).
6. **Disparadores:** auto al servir (trigger) + manual + reimpresión + config por impresora.

**Valoración de alcance (honesta):** es un MÓDULO ENTERO, probablemente varias sesiones. El
tema espinoso es N3 (transporte IP, por la limitación del navegador). Cada pieza es usable
por sí misma; se construyen en orden para que encajen sin redecidir.

---

## 7. Decisiones registradas (no perder)

- Pegatinas = **opción (c)** firme: por artículo (comida) + agrupada (bebidas/postres en su bolsa).
- Ticket de cocina **SIN alérgenos** (riesgo de ambigüedad); alérgenos → Cook Mode al pulsar.
- Pegatina **CON** iconos de alérgeno UE + icono moto + QR pequeño.
- **QR** en bolsa (grande, 100% seguro) + pegatina (pequeño). Apunta a la shop de la marca.
- **Caption del QR configurable por el cliente** (`qr_caption` por marca/local).
- **Logo en la MARCA**, no en la cuenta (`brand.logo_url`, distinto de `accounts.logo_url`).
- Primer transporte = **red local por IP**; rampa para CloudPRNT/Bluetooth/USB declarada.
- Documentos de referencia: los de **Last** (bolsa + cocina), validados en captura por Julio.
