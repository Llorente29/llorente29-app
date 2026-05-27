// supabase/functions/map-products/index.ts
//
// MOTOR DE MAPEO IA — Edge Function.
// Casa textos de una fuente (ventas) con destinos (menu_item) usando
// vía exacta (barata) + IA semántica (Sonnet 4.6 por defecto, configurable
// vía env MAPPING_MODEL). Escribe mapping_proposal + mapping_candidate.
// NO toca sale_line: solo propone. La propagación la hace el service al confirmar.
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
  if (source_kind !== 'sale_line' || target_kind !== 'menu_item') {
    return jsonResponse(400, { error: 'v1 solo soporta sale_line -> menu_item' });
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    console.error('[map-products] ANTHROPIC_API_KEY no configurada');
    return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  }
  const model = Deno.env.get('MAPPING_MODEL') ?? DEFAULT_MODEL;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sb = createClient(supabaseUrl, serviceKey);

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
