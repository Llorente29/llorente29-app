// supabase/functions/map-products/index.ts
//
// MOTOR DE MAPEO IA — Edge Function.
// Casa textos de una fuente con destinos. Dos modos (aditivos):
//  A) sale_line -> menu_item   : casa nombre de venta con la carta (vía exacta + IA).
//  B) recipe_item -> recipe_family : clasifica un ingrediente (raw) en su familia
//     AECOC (paso 3b). Misma filosofía IA-propone-humano-aprueba: escribe
//     mapping_proposal, NO toca recipe_item.family_id (lo hace el humano al aprobar).
// Escribe mapping_proposal (+ mapping_candidate en modo A). IA semántica
// (Sonnet 4.6 por defecto, configurable vía env MAPPING_MODEL).
//
// Auth: platform_admin (JWT) o service-role interna (x-internal-key).
// Patrón calcado de send-email.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const AUTO_THRESHOLD = 0.95;
const REVIEW_THRESHOLD = 0.55;
const TOP_K = 5;

interface FolvyClaims {
  is_platform_admin?: boolean;
}

interface MapRequest {
  account_id: string;
  source_kind: string;
  target_kind: string;
  brand_id?: string;
  dry_run?: boolean;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function decodeFolvyClaims(jwt: string): FolvyClaims | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(payloadB64));
    return payload.folvy ?? null;
  } catch {
    return null;
  }
}

function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ');
}

// ── MODO B: clasificación de ingredientes (raw) en familias de ingrediente ──
// Lee los raws SIN familia, manda los nombres + las 15 familias a la IA en UNA
// llamada, y escribe una mapping_proposal por raw (recipe_item -> recipe_family).
// NO escribe recipe_item.family_id: eso lo confirma el humano en la pantalla 3c.
// Anti-invención: sin familia clara -> no_candidate (queda sin clasificar).
async function classifyIngredients(
  sb: ReturnType<typeof createClient>,
  anthropicKey: string,
  model: string,
  accountId: string,
  dryRun: boolean,
): Promise<Response> {
  // Familias de ingrediente (candidatos). Scope 'ingredient' (las de plato no entran).
  const { data: families, error: famErr } = await sb
    .from('recipe_family')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('scope', 'ingredient')
    .eq('is_active', true)
    .order('position');
  if (famErr) {
    console.error('[map-products/family] error familias:', famErr.message);
    return jsonResponse(500, { error: 'Error leyendo familias de ingrediente' });
  }
  if (!families || families.length === 0) {
    return jsonResponse(400, { error: 'No hay familias de ingrediente sembradas (scope=ingredient)' });
  }

  // Una TANDA por invocación (límite de 150s del gateway). El bucle de quien llama
  // rellama hasta vaciar la cola. La "cola" = raws sin familia y SIN propuesta de
  // familia todavía (en real, cada raw clasificado deja una mapping_proposal, así
  // que la siguiente tanda no lo repite). En dry_run no escribe -> paginamos por
  // offset para no repetir (quien llama incrementa offset).
  const MAX_PER_RUN = 40;

  // Raws ya con propuesta de familia (para excluirlos de la cola en modo real).
  const { data: done, error: doneErr } = await sb
    .from('mapping_proposal')
    .select('source_ref')
    .eq('account_id', accountId)
    .eq('source_kind', 'recipe_item')
    .eq('target_kind', 'recipe_family');
  if (doneErr) {
    console.error('[map-products/family] error propuestas previas:', doneErr.message);
    return jsonResponse(500, { error: 'Error leyendo propuestas previas' });
  }
  const doneRefs = new Set((done ?? []).map((d: any) => d.source_ref as string));

  // Raws SIN familia. Traemos un margen y filtramos en memoria los ya propuestos.
  let rawQuery = sb
    .from('recipe_item')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('type', 'raw')
    .eq('is_active', true)
    .is('family_id', null)
    .order('name');
  const { data: allRaws, error: rawErr } = await rawQuery;
  if (rawErr) {
    console.error('[map-products/family] error raws:', rawErr.message);
    return jsonResponse(500, { error: 'Error leyendo ingredientes' });
  }
  // Cola: en real excluye los ya propuestos; en dry_run usa todos (no escribe).
  const pending = (allRaws ?? []).filter((r: any) => dryRun || !doneRefs.has(r.id));
  const remainingBefore = pending.length;
  const raws = pending.slice(0, MAX_PER_RUN);  // solo esta tanda

  const result = {
    mode: 'recipe_item->recipe_family',
    procesados: 0, auto_confirmados: 0, para_revisar: 0, sin_familia: 0,
    restantes: 0, dry_run: dryRun,
  };
  if (!raws || raws.length === 0) {
    return jsonResponse(200, { ...result, nota: 'No quedan ingredientes sin clasificar' });
  }

  const famList = families.map((f, i) => `${i + 1}. id=${f.id} | ${f.name}`).join('\n');
  const famById = new Map(families.map((f) => [f.id as string, f.name as string]));

  // UNA tanda (<= MAX_PER_RUN) por invocación, para no superar los 150s del gateway.
  const itemsList = raws.map((r, i) => `${i + 1}. ref=${r.id} | ${r.name}`).join('\n');
  const prompt =
    `Eres un experto en aprovisionamiento de hostelería española. Clasifica cada ` +
    `INGREDIENTE en UNA de las FAMILIAS dadas (estándar AECOC del gran consumo).\n\n` +
    `FAMILIAS (elige por id):\n${famList}\n\n` +
    `INGREDIENTES a clasificar:\n${itemsList}\n\n` +
    `Devuelve SOLO un JSON (sin markdown, sin texto extra) con esta forma:\n` +
    `{"items":[{"ref":"<ref del ingrediente>","family_id":"<id de familia o null>",` +
    `"confidence":<0..1>,"reason":"<motivo breve en español>"}]}\n` +
    `REGLAS: si el ingrediente no encaja claramente en ninguna familia, family_id null ` +
    `y confidence 0 (NO lo fuerces). Un envase/bolsa/film va a "Envases y packaging"; ` +
    `un producto de limpieza a "Droguería y limpieza". Clasifica los ${raws.length} ingredientes.`;

  let parsedItems: { ref: string; family_id: string | null; confidence: number; reason: string }[] = [];
  try {
    const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model, max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!aiResp.ok) {
      console.error('[map-products/family] IA HTTP', aiResp.status, await aiResp.text());
      return jsonResponse(502, { error: 'Error del servicio de IA' });
    }
    const aiData = await aiResp.json();
    const textOut = (aiData.content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const clean = textOut.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
  } catch (e) {
    console.error('[map-products/family] error IA/parse:', String(e));
    return jsonResponse(502, { error: 'Fallo llamando a la IA' });
  }

  const byRef = new Map(parsedItems.map((p) => [p.ref, p]));
  for (const raw of raws) {
    result.procesados++;
    const p = byRef.get(raw.id as string);
    const famId = p?.family_id && famById.has(p.family_id) ? p.family_id : null;
    const conf = typeof p?.confidence === 'number' ? p!.confidence : 0;
    const reason = p?.reason ?? '';

    let status: string;
    let chosen: string | null = famId;
    if (famId && conf >= AUTO_THRESHOLD) { status = 'auto_confirmed'; result.auto_confirmados++; }
    else if (famId && conf >= REVIEW_THRESHOLD) { status = 'needs_review'; result.para_revisar++; }
    else { status = 'no_candidate'; chosen = null; result.sin_familia++; }

    if (!dryRun) {
      const { error: propErr } = await sb.from('mapping_proposal').insert({
        account_id: accountId,
        source_kind: 'recipe_item',
        source_text: raw.name,
        source_normalized: normalize(raw.name as string),
        source_ref: raw.id,
        target_kind: 'recipe_family',
        status,
        chosen_target_id: chosen,
        confidence: conf,
        method: 'ai',
        rationale: reason,
        engine_version: model,
      });
      if (propErr) console.error('[map-products/family] insert proposal:', propErr.message);
    }
  }

  // Cuántos quedan tras esta tanda (en real: los que aún no tienen propuesta).
  result.restantes = Math.max(0, remainingBefore - result.procesados);

  console.log('[map-products/family] tanda:', JSON.stringify(result));
  return jsonResponse(200, result);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse(401, { error: 'Missing Authorization header' });
  }
  const bearer = authHeader.replace('Bearer ', '').trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalKey = req.headers.get('x-internal-key') ?? '';
  const isInternalCall = serviceKey.length > 0 && internalKey === serviceKey;

  if (!isInternalCall) {
    const folvy = decodeFolvyClaims(bearer);
    if (!folvy || folvy.is_platform_admin !== true) {
      return jsonResponse(403, { error: 'Solo platform admins pueden lanzar mapeos' });
    }
  }

  let body: MapRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Body JSON invalido' });
  }
  const { account_id, source_kind, target_kind, brand_id } = body;
  const dryRun = body.dry_run === true;
  if (!account_id || !source_kind || !target_kind) {
    return jsonResponse(400, { error: 'Faltan account_id, source_kind o target_kind' });
  }

  const SALES_MODE = source_kind === 'sale_line' && target_kind === 'menu_item';
  const FAMILY_MODE = source_kind === 'recipe_item' && target_kind === 'recipe_family';
  if (!SALES_MODE && !FAMILY_MODE) {
    return jsonResponse(400, {
      error: 'Pares soportados: sale_line->menu_item | recipe_item->recipe_family',
    });
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    console.error('[map-products] ANTHROPIC_API_KEY no configurada');
    return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  }
  const model = Deno.env.get('MAPPING_MODEL') ?? DEFAULT_MODEL;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sb = createClient(supabaseUrl, serviceKey);

  // ── MODO B: clasificar ingredientes (raws) en familias (paso 3b) ──
  // Aislado en su propia función para no tocar el camino de ventas.
  if (FAMILY_MODE) {
    return await classifyIngredients(sb, anthropicKey, model, account_id, dryRun);
  }

  const { data: lines, error: linesErr } = await sb
    .from('sale_line')
    .select('product_name, sale:sale_id ( brand_id )')
    .eq('account_id', account_id)
    .is('menu_item_id', null);
  if (linesErr) {
    console.error('[map-products] error leyendo sale_line:', linesErr.message);
    return jsonResponse(500, { error: 'Error leyendo ventas' });
  }

  const groups = new Map<string, { brandId: string | null; text: string; norm: string }>();
  for (const ln of lines ?? []) {
    const brandId = (ln as any).sale?.brand_id ?? null;
    if (brand_id && brandId !== brand_id) continue;
    const norm = normalize((ln as any).product_name);
    if (!norm) continue;
    const key = `${brandId ?? 'null'}||${norm}`;
    if (!groups.has(key)) {
      groups.set(key, { brandId, text: (ln as any).product_name, norm });
    }
  }

  const result = { procesados: 0, auto_confirmados: 0, para_revisar: 0, sin_candidato: 0, dry_run: dryRun };

  for (const g of groups.values()) {
    result.procesados++;

    let candQuery = sb
      .from('menu_item')
      .select('id, name, description')
      .eq('account_id', account_id)
      .is('archived_at', null);
    if (g.brandId) candQuery = candQuery.eq('brand_id', g.brandId);

    const { data: cands, error: candErr } = await candQuery;
    if (candErr) {
      console.error('[map-products] error candidatos:', candErr.message);
      continue;
    }

    if (!cands || cands.length === 0) {
      result.sin_candidato++;
      if (!dryRun) {
        await sb.from('mapping_proposal').insert({
          account_id, source_kind, source_text: g.text, source_normalized: g.norm,
          context_brand_id: g.brandId, target_kind, status: 'no_candidate',
          method: 'ai', engine_version: model,
        });
      }
      continue;
    }

    const exact = cands.find((c) => normalize(c.name) === g.norm);
    let chosenId: string | null = null;
    let confidence = 0;
    let method = 'ai';
    let rationale = '';
    let ranked: { id: string; label: string; score: number; reason: string }[] = [];

    if (exact) {
      chosenId = exact.id; confidence = 1.0; method = 'exact';
      rationale = `Coincidencia exacta de nombre con "${exact.name}".`;
      ranked = [{ id: exact.id, label: exact.name, score: 1.0, reason: 'Nombre identico' }];
    } else {
      const candList = cands.map((c, i) =>
        `${i + 1}. id=${c.id} | ${c.name}${c.description ? ' - ' + c.description : ''}`
      ).join('\n');
      const prompt =
        `Eres un asistente que casa nombres de productos vendidos con la carta oficial de una marca.\n` +
        `Texto de venta: "${g.text}"\n\n` +
        `Productos de la carta (candidatos):\n${candList}\n\n` +
        `Devuelve SOLO un JSON, sin texto adicional, con esta forma:\n` +
        `{"best_id": "<id o null>", "confidence": <0..1>, "rationale": "<explicacion breve en espanol>", ` +
        `"alternatives": [{"id":"<id>","score":<0..1>,"reason":"<por que>"}]}\n` +
        `Si ninguno casa, best_id null y confidence 0. Incluye en alternatives hasta ${TOP_K} candidatos ordenados por score.`;

      try {
        const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model, max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!aiResp.ok) {
          console.error('[map-products] IA HTTP', aiResp.status, await aiResp.text());
          continue;
        }
        const aiData = await aiResp.json();
        const textOut = (aiData.content ?? [])
          .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        const clean = textOut.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        chosenId = parsed.best_id ?? null;
        confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
        rationale = parsed.rationale ?? '';
        const byId = new Map(cands.map((c) => [c.id, c.name]));
        ranked = (parsed.alternatives ?? [])
          .filter((a: any) => byId.has(a.id))
          .slice(0, TOP_K)
          .map((a: any) => ({ id: a.id, label: byId.get(a.id)!, score: a.score ?? 0, reason: a.reason ?? '' }));
      } catch (e) {
        console.error('[map-products] error IA/parse:', String(e));
        continue;
      }
    }

    let status: string;
    if (chosenId && confidence >= AUTO_THRESHOLD) { status = 'auto_confirmed'; result.auto_confirmados++; }
    else if (chosenId && confidence >= REVIEW_THRESHOLD) { status = 'needs_review'; result.para_revisar++; }
    else { status = 'no_candidate'; result.sin_candidato++; chosenId = null; }

    if (!dryRun) {
      const { data: prop, error: propErr } = await sb.from('mapping_proposal').insert({
        account_id, source_kind, source_text: g.text, source_normalized: g.norm,
        context_brand_id: g.brandId, target_kind, status,
        chosen_target_id: chosenId, confidence, method,
        rationale, engine_version: model,
      }).select('id').single();
      if (propErr) { console.error('[map-products] insert proposal:', propErr.message); continue; }

      if (ranked.length > 0) {
        await sb.from('mapping_candidate').insert(
          ranked.map((r, i) => ({
            proposal_id: prop.id, target_id: r.id, target_label: r.label,
            score: r.score, rank: i + 1, reason: r.reason,
          }))
        );
      }
    }
  }

  console.log('[map-products] resultado:', JSON.stringify(result));
  return jsonResponse(200, result);
});
