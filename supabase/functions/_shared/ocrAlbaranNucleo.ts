// supabase/functions/_shared/ocrAlbaranNucleo.ts
//
// D01 (13/10) · Lo PURO de ocr-albaran, sacado tal cual de su index.ts para
// poder probarlo: la forma de lo leído (ParsedDoc), el prompt (buildPrompt),
// la extracción del JSON y la validación por base imponible. Ni una letra
// cambiada: tests/conta/d01/ocrAlbaran.test.ts fija la huella del prompt y lo
// que da validate() con los mismos ejemplos antes y después (Julio, R1 del
// D01: «lo que devuelve hoy a Cocina no cambia»).
//
// Sin dependencias de Deno ni de Node.

// El modelo de visión por defecto (VISION_MODEL lo cambia en la función). Aquí
// desde el D01 R2 para que la prueba de lectura con el modelo use el MISMO.
export const MODELO_VISION = 'claude-opus-4-8';

// Descuadre máximo aceptado entre Σlíneas y la base imponible declarada (1%).
export const BASE_TOLERANCE = 0.01;

export interface ParsedDoc {
  document: {
    supplier_name: string | null;
    supplier_tax_id: string | null;
    supplier_phone: string | null;          // Mejora 1
    supplier_email: string | null;          // Mejora 1
    supplier_address: string | null;        // Mejora 1 (domicilio del PROVEEDOR, no el de entrega)
    supplier_health_registry: string | null;// Mejora 1 (RGSEAA / nº registro sanitario)
    doc_number: string | null;
    doc_date: string | null;          // YYYY-MM-DD
    doc_type: 'albaran' | 'factura' | 'albaran_factura' | null;
    ship_to: string | null;
    bill_to_name: string | null;
    bill_to_tax_id?: string | null;   // Compras (10/10): NIF del destinatario. Solo con el prompt de ahora.
    handwritten: boolean;
    tax_base_total: number | null;    // base imponible total
    tax_total: number | null;         // IVA total
    grand_total: number | null;       // total a pagar (con IVA)
  };
  lines: {
    raw_text: string;
    supplier_code: string | null;
    quantity: number | null;
    packages: number | null;          // nº de bultos/cajas físicas (columna CAJAS/BULTOS si existe)
    unit: string | null;
    unit_price_net: number | null;    // precio NETO por unidad (tras descuento)
    discount_pct: number | null;
    line_amount: number | null;       // importe neto de la línea
    vat_pct: number | null;
    lot_code: string | null;
    expiry_date: string | null;       // YYYY-MM-DD
    note: string | null;
    // Mejora 3 — pista de FORMATO de compra (lo que la IA ve; sin convertir a base).
    format_name: string | null;       // nombre de la unidad de compra: "Caja","Saco","Garrafa","Unidad"...
    pack_size: number | null;         // contenido de UN formato (80 si "(80u)"; 5 si "Garrafa 5 L")
    pack_unit: string | null;         // unidad del contenido: "ud"|"kg"|"g"|"l"|"ml"
  }[];
  confidence: number;                 // 0..1 global
}

// conNifDestinatario = false es el prompt de ANTES del 10/10, tal cual: solo
// lo usa MEDIR, para comparar con la misma vara.
export function buildPrompt(conNifDestinatario = true): string {
  return (
    `Eres un asistente experto en albaranes y facturas de proveedores de hostelería en España.\n` +
    `Te paso una o varias imágenes (o PDF) que pueden ser PÁGINAS de un mismo documento, en cualquier orden.\n` +
    `Trátalas como un ÚNICO documento y ordénalas tú. Extrae su contenido en JSON ESTRICTO\n` +
    `(sin texto adicional, sin markdown), con esta forma EXACTA:\n` +
    `{\n` +
    `  "document": {\n` +
    `    "supplier_name": "<razón social del PROVEEDOR que emite, o null>",\n` +
    `    "supplier_tax_id": "<CIF/NIF del proveedor, o null>",\n` +
    `    "supplier_phone": "<teléfono del proveedor si aparece, o null>",\n` +
    `    "supplier_email": "<email del proveedor si aparece, o null>",\n` +
    `    "supplier_address": "<domicilio FISCAL/SOCIAL del proveedor (NO el de entrega), o null>",\n` +
    `    "supplier_health_registry": "<nº de registro sanitario / RGSEAA del proveedor si aparece, o null>",\n` +
    `    "doc_number": "<nº de albarán o factura, o null>",\n` +
    `    "doc_date": "<fecha del documento YYYY-MM-DD, o null>",\n` +
    `    "doc_type": "<albaran|factura|albaran_factura|null>",\n` +
    `    "ship_to": "<domicilio/local de ENTREGA tal cual aparece, o null>",\n` +
    `    "bill_to_name": "<a quién se FACTURA: razón social del cliente, o null>",\n` +
    (conNifDestinatario
      ? `    "bill_to_tax_id": "<CIF/NIF del CLIENTE a quien se factura, tal cual aparece, o null>",\n`
      : '') +
    `    "handwritten": <true si el documento está escrito A MANO, si no false>,\n` +
    `    "tax_base_total": <base imponible total (suma de bases, SIN IVA) o null>,\n` +
    `    "tax_total": <importe total de IVA o null>,\n` +
    `    "grand_total": <total a pagar CON IVA o null>\n` +
    `  },\n` +
    `  "lines": [\n` +
    `    {\n` +
    `      "raw_text": "<nombre del artículo TAL CUAL, sin el código>",\n` +
    `      "supplier_code": "<código de artículo del proveedor si aparece, o null>",\n` +
    `      "quantity": <cantidad servida/entregada como número, o null>,\n` +
    `      "packages": <nº de BULTOS/CAJAS físicas si hay una columna aparte (CAJAS, BULTOS, Nº CAJAS), o null>,\n` +
    `      "unit": "<ud|caja|kg|l|saco|bandeja u otra, o null>",\n` +
    `      "unit_price_net": <precio por unidad YA con el descuento aplicado, o null>,\n` +
    `      "discount_pct": <% de descuento de la línea si aparece, o null>,\n` +
    `      "line_amount": <importe NETO de la línea (lo que se paga por ella), o null>,\n` +
    `      "vat_pct": <% de IVA de la línea si aparece, o null>,\n` +
    `      "lot_code": "<lote si aparece, o null>",\n` +
    `      "expiry_date": "<caducidad YYYY-MM-DD si aparece, o null>",\n` +
    `      "note": "<cualquier coletilla relevante, o null>",\n` +
    `      "format_name": "<nombre del FORMATO de compra de la línea: 'Caja','Saco','Garrafa','Bandeja','Estuche','Unidad','Kilogramo'... o null>",\n` +
    `      "pack_size": <cuánto CONTIENE un formato como número (80 si pone '(80u)'; 5 si 'Garrafa 5 L'; 6 si 'Caja 6x1L'), o null>,\n` +
    `      "pack_unit": "<unidad del contenido del formato: ud|kg|g|l|ml, o null>"\n` +
    `    }\n` +
    `  ],\n` +
    `  "confidence": <0 a 1: tu confianza GLOBAL en la lectura>\n` +
    `}\n\n` +
    `REGLAS CRÍTICAS:\n` +
    `- NO inventes NADA. Si un dato no está, usa null. Es preferible null a un valor inventado.\n` +
    `- "line_amount" y "unit_price_net" son el importe NETO (después de descuentos). Si hay precio\n` +
    `  bruto y descuento, calcula/usa el neto; pon el % en "discount_pct".\n` +
    `- "raw_text" es SOLO el nombre del artículo (sin el código de proveedor, que va en supplier_code).\n` +
    `- Distingue PROVEEDOR (emite) de CLIENTE (recibe/factura): supplier_* es siempre el proveedor.\n` +
    (conNifDestinatario
      ? `- "bill_to_tax_id" es el NIF del CLIENTE, no el del proveedor. Si en el papel solo ves un NIF\n` +
        `  y no sabes con seguridad de cuál de los dos es, déjalo en null en el sitio dudoso.\n`
      : '') +
    `- Captura lote y caducidad por línea si aparecen (suelen ir debajo o al lado de la línea).\n` +
    `- FORMATO de compra (format_name/pack_size/pack_unit): describe la UNIDAD EN LA QUE SE COMPRA\n` +
    `  y FACTURA la línea (la misma a la que se refieren "quantity" y "unit_price_net").\n` +
    `    · Si la línea va por cajas/sacos/garrafas → format_name = ese envase ("Caja","Saco","Garrafa")\n` +
    `      y pack_size/pack_unit = cuánto contiene UNO (del texto: "(80u)" → 80 "ud"; "5 L" → 5 "l";\n` +
    `      "6x1L" → 6 "l"; "Saco 25 kg" → 25 "kg").\n` +
    `    · Si la línea va por unidades sueltas/peso → format_name = "Unidad"/"Kilogramo"/"Litro" y\n` +
    `      pack_size/pack_unit = 1 de esa unidad (1 "ud", 1 "kg", 1 "l").\n` +
    `    · Si NO puedes deducir el contenido con seguridad, deja pack_size y/o pack_unit en null\n` +
    `      (NO inventes la equivalencia; el humano la confirmará).\n` +
    `- Las cantidades e importes son números decimales con punto (no "5,99" sino 5.99; no "5 kg" sino 5).\n` +
    `- DOS COLUMNAS DE CANTIDAD: algunos albaranes traen una columna de BULTOS (CAJAS, BULTOS, Nº CAJAS)\n` +
    `  separada de la cantidad FACTURABLE (CANTIDAD, UDS, KG). En ese caso:\n` +
    `    · "packages" = los BULTOS físicos (la columna CAJAS/BULTOS).\n` +
    `    · "quantity" = la cantidad FACTURABLE, la que multiplicada por "unit_price_net" da "line_amount"\n` +
    `      (verifícalo: quantity × unit_price_net ≈ line_amount). Esa es la que va en "quantity".\n` +
    `    · Si SOLO hay una columna de cantidad, ponla en "quantity" y deja "packages" en null.\n` +
    `    · NO inventes "packages": si no hay columna de bultos separada, es null.\n` +
    `- Si el documento está MANUSCRITO o es poco legible: ponle handwritten=true, baja "confidence",\n` +
    `  y extrae solo lo que veas con seguridad (el resto null).\n` +
    `- Si no es un albarán/factura legible, devuelve {"document":{...con nulls...},"lines":[],"confidence":0}.\n` +
    `- Responde ÚNICAMENTE el JSON.`
  );
}

export function extractJson(textOut: string): ParsedDoc | null {
  try {
    const clean = textOut.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as ParsedDoc;
  } catch {
    return null;
  }
}

// Validación por BASE IMPONIBLE: Σ(line_amount) ≈ tax_base_total.
// Si no hay base declarada, intenta (grand_total - tax_total). Si nada, no se
// puede validar → needs_review por validación desconocida.
export function validate(parsed: ParsedDoc): {
  base_declared: number | null;
  lines_sum: number | null;
  diff_pct: number | null;
  cuadra: boolean | null;
  needs_review: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const linesSum = (parsed.lines ?? []).reduce(
    (acc, l) => acc + (typeof l.line_amount === 'number' ? l.line_amount : 0), 0,
  );
  const haveLineAmounts = (parsed.lines ?? []).some(l => typeof l.line_amount === 'number');

  let base = parsed.document?.tax_base_total ?? null;
  if (base === null && parsed.document?.grand_total != null && parsed.document?.tax_total != null) {
    base = parsed.document.grand_total - parsed.document.tax_total;
  }

  let diffPct: number | null = null;
  let cuadra: boolean | null = null;
  if (base !== null && base > 0 && haveLineAmounts) {
    diffPct = Math.abs(linesSum - base) / base;
    cuadra = diffPct <= BASE_TOLERANCE;
    if (!cuadra) reasons.push(`Σlíneas (${linesSum.toFixed(2)}) no cuadra con base imponible (${base.toFixed(2)})`);
  } else {
    reasons.push('No se pudo validar por base imponible (faltan importes)');
  }

  if (parsed.document?.handwritten) reasons.push('Documento manuscrito');
  if (typeof parsed.confidence === 'number' && parsed.confidence < 0.6) reasons.push('Confianza de lectura baja');

  const needsReview = cuadra === false || cuadra === null || !!parsed.document?.handwritten ||
    (typeof parsed.confidence === 'number' && parsed.confidence < 0.6);

  return {
    base_declared: base,
    lines_sum: haveLineAmounts ? Number(linesSum.toFixed(2)) : null,
    diff_pct: diffPct === null ? null : Number((diffPct * 100).toFixed(2)),
    cuadra,
    needs_review: needsReview,
    reasons,
  };
}

