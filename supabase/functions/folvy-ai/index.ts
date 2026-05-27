// supabase/functions/folvy-ai/index.ts
//
// FOLVY AI — Edge Function orquestadora (v2 con streaming).
// Plataforma común para chat flotante + AICards de cada módulo.
//
// MODOS:
// - Legacy (sin stream:true en body): responde JSON al final, igual que v1.
//   Para invocaciones desde el dashboard, AICards síncronas, o tests.
// - Streaming (stream:true): responde SSE, chunk a chunk. Eventos:
//   {type:'text',content}|{type:'tool_start',name}|{type:'tool_end',name}|
//   {type:'done',session_id,usage}|{type:'error',message}
// - Opening (surface:'opening'): saludo proactivo, inyecta instrucción
//   especial al system prompt y manda mensaje sintético "saluda".
//
// Auth: JWT del usuario. RLS aplica al leer datos.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;
const MAX_TOOL_LOOPS = 5;

const SYSTEM_PROMPT_BASE = `Eres Folvy AI, el asistente de Folvy: la plataforma operativa de cocinas fantasma multi-marca.

VOZ:
- Profesional pero cercana. Tuteas. Frases cortas. Habla en español.
- Termina con una propuesta de acción cuando tiene sentido ("¿Empezamos por...?", "¿Te paso el listado?").
- No usas emojis en el cuerpo del mensaje.
- Suenas como un socio que sabe del negocio, no como un chatbot ni un consultor.
- Puedes usar markdown ligero: **negrita** para datos clave, listas numeradas. NO uses títulos (# ##).

PRINCIPIOS:
- NUNCA inventas datos. Si no tienes el dato, dilo: "No tengo ese dato".
- NUNCA actúas sin confirmación cuando la acción cambia datos de negocio.
- Solo respondes sobre Folvy y el negocio del cliente. No eres ChatGPT general.
- Respetas los permisos del usuario: si una tool falla por permisos, NO inventas la respuesta, explicas que no tienes acceso.
- Si una tool devuelve datos vacíos o data_access='empty_or_forbidden', NO especules sobre la causa. Limítate a decir: "No veo movimientos en tu cuenta — puede ser que esté vacía o que no tenga permiso para leerla. ¿Has subido ya datos?".
- NUNCA menciones por nombre productos, integraciones, canales o funcionalidades que no aparezcan literalmente en los datos consultados o en este prompt. Si dudas de si algo existe en Folvy, pregunta al usuario en lugar de afirmarlo.

CONTEXTO DE LA PANTALLA:
{{SURFACE_CONTEXT}}

MEMORIA RELEVANTE DE ESTA CUENTA:
{{MEMORY_CONTEXT}}

Cuando necesites datos del negocio, usa las tools disponibles. No respondas con datos inventados.`;

const OPENING_INSTRUCTION = `\n\nMODO SALUDO DE APERTURA:
El usuario acaba de abrir el chat. Tu primer mensaje es el saludo de bienvenida.
- Llama a catalog_health para conocer el estado actual de la carta del cliente.
- Saluda al usuario por su nombre si lo conoces (te lo da el contexto).
- Resume en UNA FRASE el dato más importante de su estado.
- Termina con UNA propuesta concreta de acción.
- Sé directo, NO recites todos los datos.`;

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

interface ToolContext {
  accountId: string;
  userJwt: string;
  supabaseUrl: string;
}

function clientWithUserJwt(ctx: ToolContext) {
  return createClient(ctx.supabaseUrl, ctx.userJwt, {
    global: { headers: { Authorization: `Bearer ${ctx.userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const TOOL_CATALOG_HEALTH: ToolDef = {
  name: 'catalog_health',
  description:
    'Devuelve la salud actual de la carta del cliente: porcentaje de facturación ' +
    'con economía conocida, número de productos sin coste, y los top 5 productos ' +
    'vendidos sin mapear ordenados por su impacto económico. Usa esta tool cuando ' +
    'el usuario pregunte por el estado de su carta, qué falta por mapear, o cuánto ' +
    'controla de su negocio. El campo data_access indica si los datos son observables: ' +
    "'ok' si hay actividad real en la cuenta, 'empty_or_forbidden' si todo viene vacío " +
    'y no se puede distinguir si la cuenta está vacía o el permiso es insuficiente.',
  input_schema: {
    type: 'object',
    properties: {
      brand_id: {
        type: 'string',
        description: 'Opcional. UUID de la marca para filtrar.',
      },
    },
    required: [],
  },
  handler: async (args, ctx) => {
    const sb = clientWithUserJwt(ctx);
    const brandId = (args.brand_id as string | undefined) ?? null;

    const { data: lines, error: linesErr } = await sb
      .from('sale_line')
      .select('quantity, unit_price, menu_item_id, sale:sale_id(brand_id)')
      .eq('account_id', ctx.accountId);
    if (linesErr) throw new Error(`No pude leer ventas: ${linesErr.message}`);

    const filtered = brandId
      ? (lines ?? []).filter((l: any) => l.sale?.brand_id === brandId)
      : (lines ?? []);

    let totalRevenue = 0, mappedRevenue = 0;
    for (const l of filtered as any[]) {
      const rev = Number(l.quantity ?? 0) * Number(l.unit_price ?? 0);
      totalRevenue += rev;
      if (l.menu_item_id) mappedRevenue += rev;
    }

    const { data: unmapped, error: unErr } = await sb
      .from('sale_line')
      .select('product_name, quantity, unit_price, sale:sale_id(brand_id)')
      .eq('account_id', ctx.accountId)
      .is('menu_item_id', null);
    if (unErr) throw new Error(`No pude leer ventas sin mapear: ${unErr.message}`);

    const unmappedByProduct = new Map<string, number>();
    for (const l of (unmapped ?? []) as any[]) {
      if (brandId && l.sale?.brand_id !== brandId) continue;
      const rev = Number(l.quantity ?? 0) * Number(l.unit_price ?? 0);
      unmappedByProduct.set(l.product_name, (unmappedByProduct.get(l.product_name) ?? 0) + rev);
    }
    const top5 = [...unmappedByProduct.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, revenue]) => ({ name, revenue: Math.round(revenue * 100) / 100 }));

    const { count: itemsSinCoste } = await sb
      .from('menu_item')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .is('consumption_price', null)
      .is('archived_at', null);

    const pctEconomiaConocida = totalRevenue > 0
      ? Math.round((mappedRevenue / totalRevenue) * 1000) / 10
      : 0;

    // Diagnóstico de acceso a datos: si TODO viene vacío a la vez
    // (no hay sale_line ni menu_items activos), marcamos la duda
    // para que la IA NO especule sobre causas.
    const totalSaleLines = (lines ?? []).length;
    const dataAccess = (totalSaleLines === 0 && (itemsSinCoste ?? 0) === 0)
      ? 'empty_or_forbidden'
      : 'ok';

    return {
      data_access: dataAccess,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      mapped_revenue: Math.round(mappedRevenue * 100) / 100,
      unmapped_revenue: Math.round((totalRevenue - mappedRevenue) * 100) / 100,
      pct_economia_conocida: pctEconomiaConocida,
      menu_items_sin_coste: itemsSinCoste ?? 0,
      top_5_unmapped: top5,
    };
  },
};

const TOOLS: ToolDef[] = [TOOL_CATALOG_HEALTH];

function toolsForAnthropic() {
  return TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function decodeJwtSub(jwt: string): { sub: string | null; name: string | null } {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return { sub: null, name: null };
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      sub: payload.sub ?? null,
      name: payload.folvy?.full_name ?? payload.user_metadata?.full_name ?? null,
    };
  } catch { return { sub: null, name: null }; }
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Missing Authorization header' });
  const userJwt = authHeader.replace('Bearer ', '').trim();
  const { sub: userId, name: userName } = decodeJwtSub(userJwt);

  let body: {
    account_id: string;
    message: string;
    surface: string;
    module?: string;
    context?: unknown;
    session_id?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    stream?: boolean;
  };
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'JSON invalido' }); }
  const { account_id, surface } = body;
  let { message } = body;
  if (!account_id || !surface) {
    return jsonResponse(400, { error: 'Faltan account_id o surface' });
  }
  if (!['chat', 'aicard', 'background', 'opening'].includes(surface)) {
    return jsonResponse(400, { error: 'surface invalido' });
  }
  if (surface === 'opening' && (!message || !message.trim())) {
    message = 'Saluda al usuario y presenta el estado de su carta.';
  }
  if (!message) return jsonResponse(400, { error: 'Falta message' });

  const streamMode = body.stream === true;

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    console.error('[folvy-ai] ANTHROPIC_API_KEY no configurada');
    return jsonResponse(500, { error: 'IA no configurada' });
  }
  const model = Deno.env.get('FOLVY_AI_MODEL') ?? DEFAULT_MODEL;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const sbAdmin = createClient(supabaseUrl, serviceKey);

  const sbUser = createClient(supabaseUrl, userJwt, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: memoryRows } = await sbUser
    .from('ai_memory')
    .select('scope, key, value')
    .eq('account_id', account_id);
  const memoryContext = (memoryRows ?? []).length === 0
    ? '(sin memoria previa para esta cuenta)'
    : (memoryRows ?? []).map(m => `- [${m.scope}] ${m.key}: ${JSON.stringify(m.value)}`).join('\n');

  const userNameLine = userName ? `Nombre del usuario: ${userName}.` : '';
  const surfaceContext = `Surface: ${surface}${body.module ? ` (modulo: ${body.module})` : ''}. ${userNameLine}` +
    (body.context ? `\nContexto adicional: ${JSON.stringify(body.context)}` : '');

  let systemPrompt = SYSTEM_PROMPT_BASE
    .replace('{{SURFACE_CONTEXT}}', surfaceContext)
    .replace('{{MEMORY_CONTEXT}}', memoryContext);
  if (surface === 'opening') systemPrompt += OPENING_INSTRUCTION;

  const sessionId = body.session_id ?? crypto.randomUUID();
  const startedAt = Date.now();
  const toolCtx: ToolContext = { accountId: account_id, userJwt, supabaseUrl };

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    ...(body.history ?? []).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // ── RAMA STREAMING ────────────────────────────────────────────────
  if (streamMode) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const toolsUsed: Array<{ name: string; input: unknown; output: unknown }> = [];
        let tokensIn = 0, tokensOut = 0;
        let finalText = '';

        try {
          for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
            const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
              method: 'POST',
              headers: {
                'x-api-key': anthropicKey,
                'anthropic-version': ANTHROPIC_VERSION,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model, max_tokens: MAX_TOKENS,
                system: systemPrompt,
                tools: toolsForAnthropic(),
                messages,
                stream: true,
              }),
            });
            if (!aiResp.ok || !aiResp.body) {
              const errTxt = await aiResp.text();
              throw new Error(`IA HTTP ${aiResp.status}: ${errTxt}`);
            }

            const reader = aiResp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const assistantBlocks: any[] = [];
            let currentBlock: any = null;
            let currentText = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const json = line.slice(6).trim();
                if (!json) continue;
                let evt: any;
                try { evt = JSON.parse(json); } catch { continue; }

                if (evt.type === 'message_start') {
                  tokensIn += evt.message?.usage?.input_tokens ?? 0;
                } else if (evt.type === 'content_block_start') {
                  currentBlock = { ...evt.content_block };
                  currentText = '';
                  if (currentBlock.type === 'tool_use') {
                    currentBlock.input = currentBlock.input ?? {};
                    controller.enqueue(encoder.encode(sseEvent({ type: 'tool_start', name: currentBlock.name })));
                  }
                } else if (evt.type === 'content_block_delta') {
                  const d = evt.delta;
                  if (d.type === 'text_delta') {
                    currentText += d.text;
                    finalText += d.text;
                    controller.enqueue(encoder.encode(sseEvent({ type: 'text', content: d.text })));
                  } else if (d.type === 'input_json_delta') {
                    currentBlock._partial = (currentBlock._partial ?? '') + d.partial_json;
                  }
                } else if (evt.type === 'content_block_stop') {
                  if (currentBlock?.type === 'text') {
                    currentBlock.text = currentText;
                  } else if (currentBlock?.type === 'tool_use') {
                    try {
                      currentBlock.input = currentBlock._partial ? JSON.parse(currentBlock._partial) : {};
                    } catch { currentBlock.input = {}; }
                    delete currentBlock._partial;
                  }
                  assistantBlocks.push(currentBlock);
                  currentBlock = null;
                } else if (evt.type === 'message_delta') {
                  tokensOut += evt.usage?.output_tokens ?? 0;
                }
              }
            }

            const toolUses = assistantBlocks.filter(b => b.type === 'tool_use');
            if (toolUses.length === 0) break;

            messages.push({ role: 'assistant', content: assistantBlocks });
            const toolResults: any[] = [];
            for (const tu of toolUses) {
              const tool = TOOLS.find(t => t.name === tu.name);
              if (!tool) {
                controller.enqueue(encoder.encode(sseEvent({ type: 'tool_end', name: tu.name })));
                toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Tool desconocida: ${tu.name}` });
                continue;
              }
              try {
                const out = await tool.handler(tu.input ?? {}, toolCtx);
                toolsUsed.push({ name: tu.name, input: tu.input, output: out });
                toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                toolsUsed.push({ name: tu.name, input: tu.input, output: { error: msg } });
                toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: msg });
              }
              controller.enqueue(encoder.encode(sseEvent({ type: 'tool_end', name: tu.name })));
            }
            messages.push({ role: 'user', content: toolResults });
          }

          if (!finalText) finalText = '(Folvy AI no pudo formular una respuesta tras varios intentos.)';

          controller.enqueue(encoder.encode(sseEvent({
            type: 'done',
            session_id: sessionId,
            usage: { tokens_in: tokensIn, tokens_out: tokensOut, duration_ms: Date.now() - startedAt },
          })));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[folvy-ai] stream error:', msg);
          controller.enqueue(encoder.encode(sseEvent({ type: 'error', message: msg })));
        } finally {
          sbAdmin.from('ai_interaction').insert({
            account_id, user_id: userId, user_name: userName,
            surface, module: body.module ?? null, session_id: sessionId,
            request: { message, context: body.context ?? null, stream: true },
            response: { text: finalText },
            tools_used: toolsUsed,
            model, tokens_in: tokensIn, tokens_out: tokensOut,
            duration_ms: Date.now() - startedAt,
            status: 'ok',
          }).then(() => {}, () => {});
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // ── RAMA LEGACY (sin streaming, idéntica a v1) ────────────────────
  const toolsUsed: Array<{ name: string; input: unknown; output: unknown }> = [];
  let tokensIn = 0, tokensOut = 0;
  let finalText = '';
  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | null = null;

  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const aiResp = await fetch(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model, max_tokens: MAX_TOKENS,
          system: systemPrompt,
          tools: toolsForAnthropic(),
          messages,
        }),
      });
      if (!aiResp.ok) {
        const errTxt = await aiResp.text();
        throw new Error(`IA HTTP ${aiResp.status}: ${errTxt}`);
      }
      const aiData = await aiResp.json();
      tokensIn += aiData.usage?.input_tokens ?? 0;
      tokensOut += aiData.usage?.output_tokens ?? 0;
      const toolUses = (aiData.content ?? []).filter((b: any) => b.type === 'tool_use');
      const textBlocks = (aiData.content ?? []).filter((b: any) => b.type === 'text');
      if (toolUses.length === 0) {
        finalText = textBlocks.map((b: any) => b.text).join('\n').trim();
        break;
      }
      messages.push({ role: 'assistant', content: aiData.content });
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const tool = TOOLS.find(t => t.name === tu.name);
        if (!tool) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Tool desconocida: ${tu.name}` });
          continue;
        }
        try {
          const out = await tool.handler(tu.input ?? {}, toolCtx);
          toolsUsed.push({ name: tu.name, input: tu.input, output: out });
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toolsUsed.push({ name: tu.name, input: tu.input, output: { error: msg } });
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: msg });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
    if (!finalText) finalText = '(Folvy AI no pudo formular una respuesta tras varios intentos.)';
  } catch (e) {
    status = 'error';
    errorMessage = e instanceof Error ? e.message : String(e);
    console.error('[folvy-ai] error:', errorMessage);
  }

  const durationMs = Date.now() - startedAt;
  await sbAdmin.from('ai_interaction').insert({
    account_id, user_id: userId, user_name: userName,
    surface, module: body.module ?? null, session_id: sessionId,
    request: { message, context: body.context ?? null },
    response: status === 'ok' ? { text: finalText } : null,
    tools_used: toolsUsed,
    model, tokens_in: tokensIn, tokens_out: tokensOut, duration_ms: durationMs,
    status, error_message: errorMessage,
  });

  if (status === 'error') return jsonResponse(500, { error: errorMessage });
  return jsonResponse(200, {
    response: finalText,
    session_id: sessionId,
    tools_used: toolsUsed.map(t => ({ name: t.name })),
    usage: { tokens_in: tokensIn, tokens_out: tokensOut, duration_ms: durationMs },
  });
});
