// supabase/functions/ocr-compliance-doc/index.ts
//
// OCR DE DOCUMENTO DE CUMPLIMIENTO — Edge de visión (clon de ocr-albaran).
// ============================================================================
// Recibe un compliance_document ya subido (document_id) y LEE su PDF/foto con
// Claude Opus visión, extrayendo campos SEGÚN SU FAMILIA. El caso rico es
// food_spec (ficha técnica de alimento): denominación legal, referencia,
// ingredientes, los 14 ALÉRGENOS EU con los códigos EXACTOS de Folvy,
// "puede contener", fabricante, dirección y RGSEAA.
//
// NO auto-aplica nada: guarda la lectura en compliance_document.extracted y
// devuelve la propuesta. Enlazar al ingrediente y escribir recipe_item_allergen
// con respaldo (source='manual', source_document_id) es T4 ("IA propone, humano
// decide"). Aquí, lo dudoso se marca needs_review.
//
// Auth: usuario autenticado (JWT, respeta RLS: leer = miembro, escribir el
//   extracted = admin/manager) o llamada interna (x-internal-key = service role).
// Deploy NORMAL (no es webhook externo). Necesita su deno.json (import de
//   @supabase/supabase-js) — copiar el de ocr-albaran.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_VISION_MODEL = 'claude-opus-4-8';
const BUCKET = 'compliance-docs';

// Los 14 alérgenos EU con los códigos EXACTOS que usa Folvy (recipe_item_allergen).
// La IA DEBE devolver estos strings y ningún otro — así T4 los mapea sin ambigüedad.
const FOLVY_ALLERGEN_CODES = [
  'celery', 'crustaceans', 'eggs', 'fish', 'gluten', 'lupin', 'milk', 'molluscs',
  'mustard', 'nuts', 'peanuts', 'sesame', 'soy', 'sulphites',
] as const;

const DOC_FAMILIES = [
  'food_spec', 'chemical_spec', 'chemical_sds', 'pest_contract', 'pest_spec',
  'water_analysis', 'oil_manager', 'supplier_approval', 'other',
] as const;
type DocFamily = typeof DOC_FAMILIES[number];

interface OcrRequest { document_id: string }

interface ParsedComplianceDoc {
  doc_family_detected: DocFamily | null;   // la IA confirma/propone la familia
  legal_name: string | null;               // denominación legal del producto
  reference: string | null;                // referencia/código del fabricante
  manufacturer_name: string | null;
  manufacturer_address: string | null;
  health_registry: string | null;          // RGSEAA / nº registro sanitario
  issued_at: string | null;                // fecha del documento YYYY-MM-DD
  expires_at: string | null;               // caducidad/fin de vigencia YYYY-MM-DD
  // food_spec
  ingredients: string[] | null;
  allergens_contains: string[] | null;     // subconjunto de FOLVY_ALLERGEN_CODES
  allergens_may_contain: string[] | null;  // "puede contener" (subconjunto)
  // químicos
  product_registry: string | null;         // nº de registro del producto químico
  food_contact_authorized: boolean | null; // uso en industria alimentaria sí/no
  // plagas / agua / aceite / homologación
  provider_name: string | null;            // empresa DDD / laboratorio / gestor / entidad
  valid_from: string | null;               // vigencia desde YYYY-MM-DD
  valid_to: string | null;                 // vigencia hasta YYYY-MM-DD
  handwritten: boolean;
  confidence: number;                      // 0..1 global
  notes: string | null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildPrompt(family: DocFamily): string {
  const codes = FOLVY_ALLERGEN_CODES.join(', ');
  return (
    `Eres un asistente experto en documentación de seguridad alimentaria y cumplimiento en hostelería en España.\n` +
    `Te paso una o varias imágenes (o un PDF, posiblemente multipágina y en cualquier orden) de UN documento de\n` +
    `cumplimiento. La familia declarada del documento es: "${family}".\n` +
    `Extrae su contenido en JSON ESTRICTO (sin texto adicional, sin markdown), con esta forma EXACTA:\n` +
    `{\n` +
    `  "doc_family_detected": "<la familia que REALMENTE ves: food_spec|chemical_spec|chemical_sds|pest_contract|pest_spec|water_analysis|oil_manager|supplier_approval|other, o null>",\n` +
    `  "legal_name": "<denominación legal / nombre del producto o servicio, o null>",\n` +
    `  "reference": "<referencia o código del fabricante (p.ej. '63483 v008'), o null>",\n` +
    `  "manufacturer_name": "<fabricante / empresa emisora, o null>",\n` +
    `  "manufacturer_address": "<dirección del fabricante, o null>",\n` +
    `  "health_registry": "<nº de registro sanitario / RGSEAA si aparece, o null>",\n` +
    `  "issued_at": "<fecha del documento YYYY-MM-DD, o null>",\n` +
    `  "expires_at": "<fecha de caducidad o fin de vigencia YYYY-MM-DD, o null>",\n` +
    `  "ingredients": [<lista de ingredientes como textos, SOLO si es ficha de alimento; si no, null>],\n` +
    `  "allergens_contains": [<alérgenos que el documento afirma que CONTIENE, usando EXCLUSIVAMENTE estos códigos: ${codes}. Si ninguno o no aplica, null>],\n` +
    `  "allergens_may_contain": [<alérgenos marcados como "puede contener"/"trazas", con los MISMOS códigos, o null>],\n` +
    `  "product_registry": "<nº de registro del producto (químicos), o null>",\n` +
    `  "food_contact_authorized": <true/false si el documento indica que es apto para uso en industria alimentaria; si no se dice, null>,\n` +
    `  "provider_name": "<empresa de plagas (DDD) / laboratorio / gestor de residuos / entidad emisora, o null>",\n` +
    `  "valid_from": "<inicio de vigencia YYYY-MM-DD (contratos/análisis), o null>",\n` +
    `  "valid_to": "<fin de vigencia YYYY-MM-DD, o null>",\n` +
    `  "handwritten": <true si está escrito A MANO, si no false>,\n` +
    `  "confidence": <0 a 1: tu confianza GLOBAL en la lectura>,\n` +
    `  "notes": "<cualquier observación relevante, o null>"\n` +
    `}\n\n` +
    `REGLAS CRÍTICAS:\n` +
    `- NO inventes NADA. Si un dato no está, usa null. Es preferible null a un valor inventado.\n` +
    `- ALÉRGENOS: usa SOLO los 14 códigos dados (${codes}). Traduce el término del documento a su código\n` +
    `  (p.ej. "leche"→milk, "frutos de cáscara"/"frutos secos"→nuts, "cacahuete"→peanuts, "soja"→soy,\n` +
    `  "sésamo"/"ajonjolí"→sesame, "sulfitos"/"anhídrido sulfuroso"→sulphites, "apio"→celery,\n` +
    `  "mostaza"→mustard, "altramuces"→lupin, "moluscos"→molluscs, "crustáceos"→crustaceans,\n` +
    `  "huevo"→eggs, "pescado"→fish, "gluten"/"cereales con gluten"→gluten).\n` +
    `  Distingue CONTIENE (allergens_contains) de PUEDE CONTENER/TRAZAS (allergens_may_contain).\n` +
    `  Si el documento NO informa de alérgenos, deja ambas listas en null (NO pongas [] — eso afirmaría\n` +
    `  que no contiene ninguno, y eso solo se pone si el documento lo declara EXPLÍCITAMENTE).\n` +
    `- Rellena SOLO los campos que correspondan a lo que ves; el resto null.\n` +
    `- Las fechas en formato YYYY-MM-DD. Los booleanos true/false; null si no se dice.\n` +
    `- Si está MANUSCRITO o poco legible: handwritten=true, baja confidence, y extrae solo lo seguro.\n` +
    `- Responde ÚNICAMENTE el JSON.`
  );
}

function extractJson(textOut: string): ParsedComplianceDoc | null {
  try {
    const clean = textOut.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as ParsedComplianceDoc;
  } catch {
    return null;
  }
}

// Filtra los alérgenos a los 14 códigos válidos (defensa anti-invención: si la IA
// devuelve un código fuera de lista, se descarta y se anota).
function sanitizeAllergens(list: unknown, dropped: string[]): string[] | null {
  if (!Array.isArray(list)) return null;
  const valid = new Set<string>(FOLVY_ALLERGEN_CODES as unknown as string[]);
  const out: string[] = [];
  for (const x of list) {
    const c = String(x).toLowerCase().trim();
    if (valid.has(c)) { if (!out.includes(c)) out.push(c); }
    else if (c) dropped.push(c);
  }
  return out.length ? out : null;
}

// Señal de revisión: por qué un humano debe mirar antes de aplicar (T4).
function reviewSignal(family: DocFamily, p: ParsedComplianceDoc, dropped: string[]): {
  needs_review: boolean; reasons: string[];
} {
  const reasons: string[] = [];
  if (p.handwritten) reasons.push('Documento manuscrito');
  if (typeof p.confidence === 'number' && p.confidence < 0.6) reasons.push('Confianza de lectura baja');
  if (p.doc_family_detected && p.doc_family_detected !== family) {
    reasons.push(`La IA ve un "${p.doc_family_detected}" pero está clasificado como "${family}"`);
  }
  if (family === 'food_spec' && !p.allergens_contains && !p.allergens_may_contain) {
    reasons.push('No se leyeron alérgenos en una ficha de alimento');
  }
  if (dropped.length) reasons.push(`Códigos de alérgeno no reconocidos y descartados: ${dropped.join(', ')}`);
  const needs_review = reasons.length > 0;
  return { needs_review, reasons };
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
  const { document_id } = body;
  if (!document_id) return jsonResponse(400, { error: 'Falta document_id' });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('VISION_MODEL') ?? DEFAULT_VISION_MODEL;

  // ── 1) Cargar el documento (RLS: solo miembro de la cuenta lo ve) ──
  const { data: doc, error: docErr } = await sb
    .from('compliance_document')
    .select('id, doc_family, file_path, mime_type')
    .eq('id', document_id)
    .maybeSingle();
  if (docErr) return jsonResponse(403, { error: `Acceso al documento: ${docErr.message}` });
  if (!doc) return jsonResponse(404, { error: 'Documento no encontrado o sin acceso' });
  const family = (doc.doc_family as DocFamily) ?? 'other';

  // ── 2) Descargar el fichero de Storage como base64 ──
  const { data: file, error: dlErr } = await sb.storage.from(BUCKET).download(doc.file_path as string);
  if (dlErr || !file) {
    return jsonResponse(400, { error: `No se pudo leer el fichero: ${dlErr?.message ?? 'desconocido'}` });
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const b64 = btoa(binary);
  const mime = file.type || (doc.mime_type as string | null) || 'application/pdf';
  const contentBlock = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };

  // ── 3) Llamar a Opus visión ──
  const t0 = Date.now();
  let parsed: ParsedComplianceDoc | null = null;
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
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [contentBlock, { type: 'text', text: buildPrompt(family) }],
        }],
      }),
    });
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error('[ocr-compliance-doc] IA HTTP', aiResp.status, errTxt);
      return jsonResponse(502, { error: 'Error del servicio de IA', detail: errTxt.slice(0, 500) });
    }
    rawResponse = await aiResp.json();
    const textOut = ((rawResponse as { content?: Array<{ type: string; text?: string }> }).content ?? [])
      .filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    parsed = extractJson(textOut);
  } catch (e) {
    console.error('[ocr-compliance-doc] error IA:', String(e));
    return jsonResponse(502, { error: 'Fallo llamando a la IA' });
  }
  const latencyMs = Date.now() - t0;

  if (!parsed) {
    return jsonResponse(422, { error: 'La IA no devolvió una lectura válida', raw: rawResponse });
  }

  // ── 4) Anti-invención: saneo de alérgenos + señal de revisión ──
  const dropped: string[] = [];
  parsed.allergens_contains = sanitizeAllergens(parsed.allergens_contains, dropped);
  parsed.allergens_may_contain = sanitizeAllergens(parsed.allergens_may_contain, dropped);
  const review = reviewSignal(family, parsed, dropped);

  // ── 5) Guardar la lectura en el documento (NO se aplica nada al ingrediente: eso es T4) ──
  const extracted = {
    ...parsed,
    review,
    ai_model: model,
    ai_latency_ms: latencyMs,
    extracted_at: new Date().toISOString(),
  };
  const { error: updErr } = await sb
    .from('compliance_document')
    .update({ extracted: extracted as unknown, updated_at: new Date().toISOString() })
    .eq('id', document_id);
  if (updErr) {
    console.error('[ocr-compliance-doc] update extracted:', updErr.message);
    return jsonResponse(500, { error: 'No se pudo guardar la lectura', detail: updErr.message });
  }

  // ── 6) Devolver la propuesta para la pantalla de revisión (T4) ──
  return jsonResponse(200, {
    document_id,
    doc_family: family,
    parsed,
    review,
    ai_model: model,
    ai_latency_ms: latencyMs,
  });
});
