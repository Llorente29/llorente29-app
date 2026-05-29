// supabase/functions/extract-recipe/index.ts
//
// EXTRACCIÓN DE ESCANDALLOS — Edge Function multi-formato (visión primero).
// Punto de entrada único: recibe un documento (foto/PDF hoy; voz/excel/manual
// después) y extrae un escandallo estructurado con Claude Opus visión.
// NO materializa: crea una recipe_item_ai_session (pending_review) y deja las
// líneas extraídas listas para mapear (mapping_proposal) y para que el humano
// revise. La materialización a recipe_item/recipe_line ocurre al confirmar.
//
// Arquitectura: extracción (lo que solo la IA de visión puede hacer) separada
// del mapeo (pieza unificada run_mapping + mapping_proposal, igual que ventas).
// Patrón de Edge Function calcado de map-products (auth, CORS, Anthropic, parseo).
//
// Auth: usuario autenticado (JWT) o llamada interna (x-internal-key = service role).

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Mejor modelo de visión disponible (lee fichas densas con gramajes). Configurable.
const DEFAULT_VISION_MODEL = 'claude-opus-4-8';
const BUCKET = 'recipe-uploads';

interface ExtractRequest {
  account_id: string;
  kind: 'photo' | 'voice' | 'conversational' | 'manual_assistance';
  file_paths?: string[];   // rutas dentro del bucket recipe-uploads/{account_id}/...
  input_text?: string;     // para manual/conversational
  brand_hint?: string;     // marca probable, ayuda a la extracción (opcional)
}

// Estructura intermedia COMÚN (el contrato que unifica todos los formatos)
interface ParsedRecipe {
  dish: { name: string; brand?: string | null; yield_portions?: number | null };
  lines: { raw_text: string; quantity: number | null; unit: string | null; cost?: number | null; note?: string | null }[];
  steps?: { position: number; text: string }[];
  notes?: string | null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Prompt de extracción por visión: devuelve SOLO JSON con el contrato común.
function buildVisionPrompt(brandHint?: string): string {
  return (
    `Eres un asistente experto en fichas técnicas de cocina y escandallos.\n` +
    `Te paso la imagen de una ficha de receta / escandallo de un restaurante.\n` +
    `Extrae su contenido en JSON ESTRICTO (sin texto adicional, sin markdown), con esta forma EXACTA:\n` +
    `{\n` +
    `  "dish": {"name": "<nombre del plato>", "brand": ${brandHint ? `"${brandHint}"` : 'null'}, "yield_portions": <raciones o null>},\n` +
    `  "lines": [\n` +
    `    {"raw_text": "<SOLO el nombre del ingrediente>", "quantity": <número o null>, "unit": "<g|ml|ud|kg|l u otra, o null>", "cost": <coste si aparece o null>, "note": "<anotaciones o null>"}\n` +
    `  ],\n` +
    `  "steps": [{"position": 1, "text": "<paso de elaboración>"}],\n` +
    `  "notes": "<observaciones generales o null>"\n` +
    `}\n\n` +
    `REGLAS:\n` +
    `- "raw_text" debe ser SOLO el nombre del ingrediente como figuraría en un catálogo de compras, SIN anotaciones.\n` +
    `  Cualquier coletilla de cantidad, formato, presentación o merma va en "note", NO en "raw_text". Ejemplos:\n` +
    `    · "Carne mixta picada 2 Patty"  → raw_text "Carne mixta picada", note "2 Patty"\n` +
    `    · "Queso Cheddar Loncheado (Lonchas) 2 lonchas" → raw_text "Queso Cheddar Loncheado", note "2 lonchas"\n` +
    `    · "Pepinillos Agridulce en Rodajas (Rodajas) Bruto 22,22 gr" → raw_text "Pepinillos Agridulce en Rodajas", note "Bruto 22,22 gr"\n` +
    `- Mantén el nombre del ingrediente literal (no lo traduzcas ni lo corrijas); solo sepáralo de sus anotaciones.\n` +
    `- Cantidades como número decimal (170, no "170g"); la unidad va aparte en "unit".\n` +
    `- Si un dato no está en la imagen, usa null. NO inventes cantidades ni costes.\n` +
    `- Si la imagen no es una receta legible, devuelve {"dish":{"name":null},"lines":[]}.\n` +
    `- Responde ÚNICAMENTE el JSON.`
  );
}

function extractJson(textOut: string): ParsedRecipe | null {
  try {
    const clean = textOut.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as ParsedRecipe;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });
  const bearer = authHeader.replace('Bearer ', '').trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalKey = req.headers.get('x-internal-key') ?? '';
  const isInternalCall = serviceKey.length > 0 && internalKey === serviceKey;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  // Cliente con el JWT del usuario (respeta RLS) salvo llamada interna (service role)
  const sb = isInternalCall
    ? createClient(supabaseUrl, serviceKey)
    : createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
      });

  let body: ExtractRequest;
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Body JSON inválido' }); }

  const { account_id, kind, file_paths, brand_hint } = body;
  if (!account_id || !kind) return jsonResponse(400, { error: 'Faltan account_id o kind' });
  if (kind !== 'photo') {
    return jsonResponse(400, { error: `Extractor '${kind}' aún no implementado; v1 soporta 'photo'` });
  }
  if (!file_paths || file_paths.length === 0) {
    return jsonResponse(400, { error: "kind 'photo' requiere file_paths" });
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('VISION_MODEL') ?? DEFAULT_VISION_MODEL;

  // ── 1) Leer imagen(es) de Storage como base64 ──
  const imageBlocks: unknown[] = [];
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
    imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
    inputFiles.push({ path, bucket: BUCKET });
  }

  // ── 2) Llamar a Opus visión ──
  const t0 = Date.now();
  let parsed: ParsedRecipe | null = null;
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
          content: [...imageBlocks, { type: 'text', text: buildVisionPrompt(brand_hint) }],
        }],
      }),
    });
    if (!aiResp.ok) {
      const errTxt = await aiResp.text();
      console.error('[extract-recipe] IA HTTP', aiResp.status, errTxt);
      return jsonResponse(502, { error: 'Error del servicio de IA', detail: errTxt.slice(0, 500) });
    }
    rawResponse = await aiResp.json();
    const textOut = ((rawResponse as any).content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    parsed = extractJson(textOut);
  } catch (e) {
    console.error('[extract-recipe] error IA:', String(e));
    return jsonResponse(502, { error: 'Fallo llamando a la IA' });
  }
  const latencyMs = Date.now() - t0;

  if (!parsed || !parsed.dish) {
    return jsonResponse(422, { error: 'La IA no devolvió un escandallo legible', raw: rawResponse });
  }

  // ── 3) Crear la sesión de IA (pending_review) ──
  const { data: session, error: sessErr } = await sb.from('recipe_item_ai_session').insert({
    account_id,
    kind: 'photo',
    input_files: inputFiles as unknown,
    raw_response: rawResponse as unknown,
    parsed_result: parsed as unknown,
    ai_model: model,
    ai_latency_ms: latencyMs,
    status: 'pending_review',
  }).select('id').single();
  if (sessErr) {
    console.error('[extract-recipe] insert sesión:', sessErr.message);
    return jsonResponse(500, { error: 'No se pudo guardar la sesión', detail: sessErr.message });
  }

  // ── 4) Crear una mapping_proposal por línea (mapeo unificado, source_ref=sesión) ──
  // El match fino (run_mapping + IA) lo resuelve el paso de mapeo; aquí dejamos
  // las propuestas creadas en estado inicial para la pantalla de revisión.
  // method se deja NULL: aún no hay match (lo asigna run_mapping al resolver).
  // status 'pending' = propuesta creada, sin mapear todavía.
  // Normalización IDÉNTICA a normalize_ingredient_name del SQL (minúsculas +
  // sin acentos + sin paréntesis + espacios colapsados) para que el mapeo case.
  const normalize = (s: string): string =>
    s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

  // Dedup dentro de la ficha por source_normalized (el índice único es por texto
  // normalizado a nivel de cuenta; un mismo ingrediente repetido se mapea una vez).
  const seen = new Set<string>();
  const proposals = (parsed.lines ?? [])
    .filter((l) => l.raw_text && l.raw_text.trim() !== '')
    .map((l) => ({
      account_id,
      source_kind: 'recipe_ingredient',
      source_text: l.raw_text,
      source_normalized: normalize(l.raw_text),
      source_ref: session.id,
      target_kind: 'recipe_item',
      status: 'pending',
    }))
    .filter((p) => {
      if (seen.has(p.source_normalized)) return false;
      seen.add(p.source_normalized);
      return true;
    });

  let insertedProposals = 0;
  let proposalError: string | null = null;
  if (proposals.length > 0) {
    // insert simple: el dedup interno (arriba) evita choques dentro de la ficha.
    // DEUDA: para reprocesar una ficha ya procesada sin chocar con el índice único
    // (mapping_proposal_uq, basado en expresión COALESCE), añadir manejo de
    // duplicados (consultar existentes e insertar solo nuevas). Pendiente.
    const { data: inserted, error: propErr } = await sb
      .from('mapping_proposal')
      .insert(proposals)
      .select('id');
    if (propErr) {
      console.error('[extract-recipe] insert proposals:', propErr.message);
      proposalError = `${propErr.message} | code=${propErr.code ?? ''} | details=${propErr.details ?? ''} | hint=${propErr.hint ?? ''}`;
    } else {
      insertedProposals = inserted?.length ?? 0;
    }
  }

  // ── 5) Devolver sesión + escandallo extraído para la pantalla de revisión ──
  return jsonResponse(200, {
    session_id: session.id,
    status: 'pending_review',
    parsed,
    lines_extracted: proposals.length,    // líneas leídas de la ficha
    lines_mapped: insertedProposals,       // propuestas realmente guardadas
    proposal_error: proposalError,         // DIAGNÓSTICO: error del INSERT si lo hubo
    ai_model: model,
    ai_latency_ms: latencyMs,
  });
});
