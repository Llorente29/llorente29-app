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
// Auth: usuario autenticado (JWT, respeta RLS) o llamada interna (x-internal-key).
// Patrón calcado de extract-recipe.

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
  file_paths: string[];   // rutas dentro de receipt-uploads/{account_id}/...
}

interface ParsedDoc {
  document: {
    supplier_name: string | null;
    supplier_tax_id: string | null;
    doc_number: string | null;
    doc_date: string | null;          // YYYY-MM-DD
    doc_type: 'albaran' | 'factura' | 'albaran_factura' | null;
    ship_to: string | null;
    bill_to_name: string | null;
    handwritten: boolean;
    tax_base_total: number | null;    // base imponible total
    tax_total: number | null;         // IVA total
    grand_total: number | null;       // total a pagar (con IVA)
  };
  lines: {
    raw_text: string;
    supplier_code: string | null;
    quantity: number | null;
    unit: string | null;
    unit_price_net: number | null;    // precio NETO por unidad (tras descuento)
    discount_pct: number | null;
    line_amount: number | null;       // importe neto de la línea
    vat_pct: number | null;
    lot_code: string | null;
    expiry_date: string | null;       // YYYY-MM-DD
    note: string | null;
  }[];
  confidence: number;                 // 0..1 global
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildPrompt(): string {
  return (
    `Eres un asistente experto en albaranes y facturas de proveedores de hostelería en España.\n` +
    `Te paso una o varias imágenes (o PDF) que pueden ser PÁGINAS de un mismo documento, en cualquier orden.\n` +
    `Trátalas como un ÚNICO documento y ordénalas tú. Extrae su contenido en JSON ESTRICTO\n` +
    `(sin texto adicional, sin markdown), con esta forma EXACTA:\n` +
    `{\n` +
    `  "document": {\n` +
    `    "supplier_name": "<razón social del PROVEEDOR que emite, o null>",\n` +
    `    "supplier_tax_id": "<CIF/NIF del proveedor, o null>",\n` +
    `    "doc_number": "<nº de albarán o factura, o null>",\n` +
    `    "doc_date": "<fecha del documento YYYY-MM-DD, o null>",\n` +
    `    "doc_type": "<albaran|factura|albaran_factura|null>",\n` +
    `    "ship_to": "<domicilio/local de ENTREGA tal cual aparece, o null>",\n` +
    `    "bill_to_name": "<a quién se FACTURA: razón social del cliente, o null>",\n` +
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
    `      "unit": "<ud|caja|kg|l|saco|bandeja u otra, o null>",\n` +
    `      "unit_price_net": <precio por unidad YA con el descuento aplicado, o null>,\n` +
    `      "discount_pct": <% de descuento de la línea si aparece, o null>,\n` +
    `      "line_amount": <importe NETO de la línea (lo que se paga por ella), o null>,\n` +
    `      "vat_pct": <% de IVA de la línea si aparece, o null>,\n` +
    `      "lot_code": "<lote si aparece, o null>",\n` +
    `      "expiry_date": "<caducidad YYYY-MM-DD si aparece, o null>",\n` +
    `      "note": "<cualquier coletilla relevante, o null>"\n` +
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
    `- Captura lote y caducidad por línea si aparecen (suelen ir debajo o al lado de la línea).\n` +
    `- Si el documento está MANUSCRITO o es poco legible: ponle handwritten=true, baja "confidence",\n` +
    `  y extrae solo lo que veas con seguridad (el resto null).\n` +
    `- Las cantidades e importes son números decimales con punto (no "5,99" sino 5.99; no "5 kg" sino 5).\n` +
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

  const { account_id, file_paths } = body;
  if (!account_id) return jsonResponse(400, { error: 'Falta account_id' });
  if (!file_paths || file_paths.length === 0) return jsonResponse(400, { error: 'Faltan file_paths' });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('VISION_MODEL') ?? DEFAULT_VISION_MODEL;

  // ── 1) Leer fichero(s) de Storage como base64 ──
  const contentBlocks: unknown[] = [];
  const inputFiles: { path: string; bucket: string }[] = [];
  for (const path of file_paths) {
    const { data: file, error: dlErr } = await sb.storage.from(BUCKET).download(path);
    if (dlErr || !file) {
      return jsonResponse(400, { error: `No se pudo leer ${path}: ${dlErr?.message ?? 'desconocido'}` });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);
    const mime = file.type || 'image/jpeg';
    // PDF como document, imagen como image (la API de visión acepta ambos).
    if (mime === 'application/pdf') {
      contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    } else {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
    }
    inputFiles.push({ path, bucket: BUCKET });
  }

  // ── 2) Llamar a Opus visión ──
  const t0 = Date.now();
  let parsed: ParsedDoc | null = null;
  let rawResponse: unknown = null;
  try {
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
        messages: [{
          role: 'user',
          content: [...contentBlocks, { type: 'text', text: buildPrompt() }],
        }],
      }),
    });
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error('[ocr-albaran] IA HTTP', aiResp.status, errTxt);
      return jsonResponse(502, { error: 'Error del servicio de IA', detail: errTxt.slice(0, 500) });
    }
    rawResponse = await aiResp.json();
    const textOut = ((rawResponse as any).content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    parsed = extractJson(textOut);
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
