// supabase/functions/ocr-albaran/index.ts
//
// OCR DE ALBARÁN — Edge Function de visión (clon de extract-recipe).
// Recibe una o varias imágenes/PDF de un albarán o factura de proveedor y extrae
// cabecera + líneas + impuestos con Claude Opus visión. NO materializa recepción
// (eso es C2.2.a-2): crea una goods_receipt_ai_session (pending_review) con lo
// leído y una VALIDACIÓN por base imponible (Σlíneas ≈ base). El humano revisa.
//
// Diseñado contra muestra real (Makro multipágina, Coheldi con descuentos,
// Europastry PDF, Nobleza manuscrito, Bidfood con lote/caducidad):
//   · Acepta VARIAS imágenes (multipágina, en cualquier orden).
//   · Captura supplier_code por línea (ancla de casado fuerte para C2.2.b).
//   · Captura precio NETO (tras descuento), lote y caducidad (hueco FEFO).
//   · Detecta manuscrito y baja la confianza.
//   · Valida por BASE IMPONIBLE, no por total con IVA.
//
// Tramo A (07/06) — recepción "0 errores en paso de datos":
//   · Mejora 1: captura CONTACTO del proveedor (teléfono/email/dirección/registro
//     sanitario) para volcar el proveedor completo, no solo nombre+CIF.
//   · Mejora 3: por línea, una PISTA DE FORMATO de compra (format_name + contenido
//     pack_size/pack_unit) leída del texto. La IA NO convierte a base (no conoce
//     la unidad base del artículo, que puede no existir aún): solo propone lo que
//     ve. El front, cuando ya sabe el artículo y su unidad base, calcula el
//     qty_in_base y el humano confirma (anti-invención: si no cuadra, needs_review).
//
// Compras (10/10) — el NIF del DESTINATARIO (bill_to_tax_id), campo nuevo. Los
// demás campos no cambian. Sirve para decidir con seguridad si un papel va a
// nombre de la empresa, del proveedor que liquida o de otro (goods_receipt_path).
// El NIF del EMISOR (supplier_tax_id) nunca se aplica solo a la ficha: se ofrece.
//
// MEDIR (10/10): con { account_id, medir_sesiones: [ids] } no guarda nada.
// Relee los ficheros de esas sesiones DOS VECES en la misma llamada, con el
// prompt de antes y con el de ahora, y devuelve campo a campo qué cambia. La
// misma vara a los dos lados (regla 31): mismo modelo, mismo día, mismas fotos.
// Lo lanza el workflow «Medir el NIF del destinatario (ocr-albaran)».
//
// Auth: usuario autenticado (JWT, respeta RLS) o llamada interna (x-internal-key).
// Patrón calcado de extract-recipe. Deploy NORMAL (no es webhook externo).

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_VISION_MODEL = 'claude-opus-4-8';
const BUCKET = 'receipt-uploads';
// Descuadre máximo aceptado entre Σlíneas y la base imponible declarada (1%).
const BASE_TOLERANCE = 0.01;

interface OcrRequest {
  account_id: string;
  file_paths?: string[];       // rutas dentro de receipt-uploads/{account_id}/...
  medir_sesiones?: string[];   // MEDIR: ids de goods_receipt_ai_session a releer (máx. MEDIR_MAX)
}

const MEDIR_MAX = 40;

interface ParsedDoc {
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// conNifDestinatario = false es el prompt de ANTES del 10/10, tal cual: solo
// lo usa MEDIR, para comparar con la misma vara.
function buildPrompt(conNifDestinatario = true): string {
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

function extractJson(textOut: string): ParsedDoc | null {
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
function validate(parsed: ParsedDoc): {
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

// deno-lint-ignore no-explicit-any
type Sb = any;

async function bloquesDe(sb: Sb, paths: string[]): Promise<{ blocks: unknown[]; files: { path: string; bucket: string }[] } | { error: string }> {
  const blocks: unknown[] = [];
  const files: { path: string; bucket: string }[] = [];
  for (const path of paths) {
    const { data: file, error: dlErr } = await sb.storage.from(BUCKET).download(path);
    if (dlErr || !file) return { error: `No se pudo leer ${path}: ${dlErr?.message ?? 'desconocido'}` };
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);
    const mime = file.type || 'image/jpeg';
    // PDF como document, imagen como image (la API de visión acepta ambos).
    if (mime === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    } else {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
    }
    files.push({ path, bucket: BUCKET });
  }
  return { blocks, files };
}

async function leerConIa(anthropicKey: string, model: string, blocks: unknown[], prompt: string):
  Promise<{ parsed: ParsedDoc | null; raw: unknown } | { error: string; status: number }> {
  const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text: prompt }] }],
    }),
  });
  if (!aiResp.ok) {
    const errTxt = await aiResp.text();
    console.error('[ocr-albaran] IA HTTP', aiResp.status, errTxt);
    return { error: errTxt.slice(0, 500), status: aiResp.status };
  }
  const raw = await aiResp.json();
  // deno-lint-ignore no-explicit-any
  const textOut = ((raw as any).content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return { parsed: extractJson(textOut), raw };
}

// MEDIR: lo que se compara entre el prompt de antes y el de ahora. Ni nombres
// ni NIF salen de aquí: solo si coinciden (el informe va a un repositorio
// público). Del NIF del destinatario se dice si se leyó y a quién corresponde.
function huella(p: ParsedDoc | null) {
  const d = p?.document;
  const lineas = p?.lines ?? [];
  const suma = lineas.reduce((a, l) => a + (typeof l.line_amount === 'number' ? l.line_amount : 0), 0);
  return {
    doc_type: d?.doc_type ?? null,
    doc_number: d?.doc_number ?? null,
    doc_date: d?.doc_date ?? null,
    supplier_tax_id: (d?.supplier_tax_id ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
    bill_to_name: (d?.bill_to_name ?? '').trim().toUpperCase() || null,
    tax_base_total: d?.tax_base_total ?? null,
    tax_total: d?.tax_total ?? null,
    grand_total: d?.grand_total ?? null,
    lineas: lineas.length,
    suma_lineas: Number(suma.toFixed(2)),
    tipos_iva: [...new Set(lineas.map(l => l.vat_pct).filter(v => v != null))].sort().join(','),
  };
}

async function medir(sb: Sb, anthropicKey: string, model: string, accountId: string, ids: string[]): Promise<Response> {
  if (ids.length > MEDIR_MAX) return jsonResponse(400, { error: `Como mucho ${MEDIR_MAX} sesiones por llamada` });
  const { data: sesiones, error } = await sb.from('goods_receipt_ai_session')
    .select('id, input_files').eq('account_id', accountId).in('id', ids);
  if (error) return jsonResponse(500, { error: error.message });
  const { data: empresas } = await sb.from('company').select('tax_id').eq('account_id', accountId);
  const { data: proveedores } = await sb.from('supplier').select('tax_id, invoicing_mode').eq('account_id', accountId).is('archived_at', null);
  const norm = (x: string | null | undefined) => (x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '');
  const nifEmpresas = new Set(((empresas ?? []) as { tax_id: string | null }[]).map(e => norm(e.tax_id)).filter(Boolean));
  const nifProveedores = new Map(((proveedores ?? []) as { tax_id: string | null; invoicing_mode: string | null }[])
    .filter(p => p.tax_id).map(p => [norm(p.tax_id), p.invoicing_mode]));

  const resultados = [];
  for (const s of (sesiones ?? []) as { id: string; input_files: { path: string }[] | null }[]) {
    const paths = (s.input_files ?? []).map(f => f.path);
    if (paths.length === 0) { resultados.push({ sesion: s.id, error: 'sin ficheros' }); continue; }
    const b = await bloquesDe(sb, paths);
    if ('error' in b) { resultados.push({ sesion: s.id, error: b.error }); continue; }
    const antes = await leerConIa(anthropicKey, model, b.blocks, buildPrompt(false));
    const ahora = await leerConIa(anthropicKey, model, b.blocks, buildPrompt(true));
    if ('error' in antes || 'error' in ahora) { resultados.push({ sesion: s.id, error: 'la IA no contestó' }); continue; }
    const ha = huella(antes.parsed);
    const hn = huella(ahora.parsed);
    const distintos = (Object.keys(ha) as (keyof typeof ha)[]).filter(k => JSON.stringify(ha[k]) !== JSON.stringify(hn[k]));
    const nif = norm(ahora.parsed?.document?.bill_to_tax_id ?? null);
    resultados.push({
      sesion: s.id,
      campos_distintos: distintos,
      nif_destinatario: !nif ? 'no leído'
        : nifEmpresas.has(nif) ? 'es el de una empresa de la cuenta'
        : nifProveedores.has(nif) ? `es el de un proveedor (${nifProveedores.get(nif) ?? 'sin forma'})`
        : nif === hn.supplier_tax_id ? 'es el del emisor (mal leído)'
        : 'no es de nadie conocido',
    });
  }
  return jsonResponse(200, { model, medidas: resultados });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalKey = req.headers.get('x-internal-key') ?? '';
  const isInternalCall = serviceKey.length > 0 && internalKey === serviceKey;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sb = isInternalCall
    ? createClient(supabaseUrl, serviceKey)
    : createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
      });

  let body: OcrRequest;
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Body JSON inválido' }); }

  const { account_id, file_paths, medir_sesiones } = body;
  if (!account_id) return jsonResponse(400, { error: 'Falta account_id' });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('VISION_MODEL') ?? DEFAULT_VISION_MODEL;

  if (medir_sesiones && medir_sesiones.length > 0) {
    return await medir(sb, anthropicKey, model, account_id, medir_sesiones);
  }
  if (!file_paths || file_paths.length === 0) return jsonResponse(400, { error: 'Faltan file_paths' });

  // ── 1) Leer fichero(s) de Storage como base64 ──
  const b = await bloquesDe(sb, file_paths);
  if ('error' in b) return jsonResponse(400, { error: b.error });
  const contentBlocks = b.blocks;
  const inputFiles = b.files;

  // ── 2) Llamar a Opus visión ──
  const t0 = Date.now();
  let parsed: ParsedDoc | null = null;
  let rawResponse: unknown = null;
  try {
    const r = await leerConIa(anthropicKey, model, contentBlocks, buildPrompt());
    if ('error' in r) return jsonResponse(502, { error: 'Error del servicio de IA', detail: r.error });
    parsed = r.parsed;
    rawResponse = r.raw;
  } catch (e) {
    console.error('[ocr-albaran] error IA:', String(e));
    return jsonResponse(502, { error: 'Fallo llamando a la IA' });
  }
  const latencyMs = Date.now() - t0;

  if (!parsed || !parsed.document) {
    return jsonResponse(422, { error: 'La IA no devolvió un albarán legible', raw: rawResponse });
  }

  // ── 3) Validación por base imponible ──
  const validation = validate(parsed);

  // ── 4) Guardar la sesión IA (pending_review) ──
  const kind = inputFiles.some(f => f.path.toLowerCase().endsWith('.pdf')) ? 'pdf' : 'photo';
  const { data: session, error: sessErr } = await sb.from('goods_receipt_ai_session').insert({
    account_id,
    kind,
    input_files: inputFiles as unknown,
    raw_response: rawResponse as unknown,
    parsed_result: parsed as unknown,
    validation: validation as unknown,
    ai_model: model,
    ai_latency_ms: latencyMs,
    status: 'pending_review',
  }).select('id').single();
  if (sessErr) {
    console.error('[ocr-albaran] insert sesión:', sessErr.message);
    return jsonResponse(500, { error: 'No se pudo guardar la sesión', detail: sessErr.message });
  }

  // ── 5) Devolver lo leído + validación para la pantalla de revisión ──
  return jsonResponse(200, {
    session_id: session.id,
    status: 'pending_review',
    parsed,
    validation,
    lines_extracted: (parsed.lines ?? []).length,
    ai_model: model,
    ai_latency_ms: latencyMs,
  });
});
