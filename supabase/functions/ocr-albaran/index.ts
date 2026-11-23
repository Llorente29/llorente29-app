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
// D01 (13/10) · MODO FACTURA: con { modo: 'factura' } el prompt de siempre
// lleva al final PROMPT_FACTURA y la respuesta, la lectura comprobada
// («factura»: proveedor, número y su clave, bases y cuotas por tipo, recargo,
// retención, vencimiento, rectificativa; con su confianza y su porqué). Lo
// puro está en _shared/ocrAlbaranNucleo.ts (sacado tal cual) y
// _shared/lecturaFactura.ts. Sin modo, lo que devuelve a Cocina no cambia.
//
// E10 (23/11) · LA FACTURA LARGA SE LEE ENTERA. En modo factura, si la respuesta llega
// CORTADA (stop_reason max_tokens: la factura trae más líneas de las que caben), se lee en
// dos pasos (_shared/lecturaPorPartes.ts): primero la cabecera, siempre corta, y se guarda
// la sesión como siempre (la factura entra con sus bases); después, sin esperar, las líneas
// página a página, que se guardan en la misma sesión y en la factura
// (conta_lectura_lineas_guardar). Con { releer_lineas: sesión } se leen las páginas que
// faltan («Leer las que faltan»). Lo que hoy no llega cortado no cambia en nada.
//
// Auth: usuario autenticado (JWT, respeta RLS) o llamada interna (x-internal-key).
// Patrón calcado de extract-recipe. Deploy NORMAL (no es webhook externo).

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';
import { MODELO_VISION, buildPrompt, extractJson, validate, type ParsedDoc } from '../_shared/ocrAlbaranNucleo.ts';
import { PROMPT_CUADRO, comprobarCuadro } from '../_shared/lecturaCuadro.ts';
import { leerFactura, PROMPT_FACTURA, type LecturaModelo } from '../_shared/lecturaFactura.ts';
import { falloDeContenido, falloDeExcepcion, falloDeRespuesta, paraGuardar, type FalloLectura } from '../_shared/lecturaFallo.ts';
import { baseDeLaCabecera, esCortada, estadoVisto, leerCabecera, leerLasLineas, type EstadoLineas, type Fichero, type LineaLeida } from '../_shared/lecturaPorPartes.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// D01 R2: el modelo vive en el núcleo, para que la prueba de lectura use el mismo.
const DEFAULT_VISION_MODEL = MODELO_VISION;
const BUCKET = 'receipt-uploads';

interface OcrRequest {
  account_id: string;
  file_paths?: string[];       // rutas dentro de receipt-uploads/{account_id}/...
  medir_sesiones?: string[];   // MEDIR: ids de goods_receipt_ai_session a releer (máx. MEDIR_MAX)
  // D01 (13/10): «factura» añade al prompt de siempre la clave «factura»
  // (vencimiento, cuadro de impuestos, recargo, retención, rectificativa, IBAN)
  // y devuelve la lectura comprobada (_shared/lecturaFactura.ts). Sin modo,
  // todo es exactamente como antes.
  // S01d (30/10): «cuadro» lee un cuadro de amortización o la resolución de
  // un aplazamiento y devuelve sus filas comprobadas (_shared/lecturaCuadro.ts),
  // sin guardar sesión: lo guarda Bancos cuando la persona confirma.
  modo?: 'factura' | 'cuadro';
  // E10: «Leer las que faltan» de una factura larga: la sesión cuyas líneas faltan.
  releer_lineas?: string;
}

const MEDIR_MAX = 40;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// deno-lint-ignore no-explicit-any
type Sb = any;

async function bloquesDe(sb: Sb, paths: string[]): Promise<{ blocks: unknown[]; files: { path: string; bucket: string }[]; ficheros: Fichero[] } | { error: string }> {
  const blocks: unknown[] = [];
  const files: { path: string; bucket: string }[] = [];
  const ficheros: Fichero[] = []; // E10: los bytes, para partir una factura larga en páginas
  for (const path of paths) {
    const { data: file, error: dlErr } = await sb.storage.from(BUCKET).download(path);
    if (dlErr || !file) return { error: `No se pudo leer ${path}: ${dlErr?.message ?? 'desconocido'}` };
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);
    const mime = file.type || 'image/jpeg';
    ficheros.push({ bytes: buf, mime });
    // PDF como document, imagen como image (la API de visión acepta ambos).
    if (mime === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    } else {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
    }
    files.push({ path, bucket: BUCKET });
  }
  return { blocks, files, ficheros };
}

// E02 · Una lectura que falla también deja su sesión (status 'failed'): con qué falló, en
// validation.fallo (clase, causa, código, stop_reason, uso y el principio y el final de lo
// que contestó; sin cabeceras, sin claves y sin el documento). Nadie la enlaza: no sale en
// ninguna lista. Si no se puede guardar, la respuesta es la misma (se dice en el registro).
async function guardarFallo(sb: Sb, x: { account_id: string; files: { path: string; bucket: string }[]; model: string; latencyMs: number | null; fallo: FalloLectura }): Promise<string | null> {
  const kind = x.files.some(f => f.path.toLowerCase().endsWith('.pdf')) ? 'pdf' : 'photo';
  const { data, error } = await sb.from('goods_receipt_ai_session').insert({
    account_id: x.account_id, kind, input_files: x.files as unknown, raw_response: null, parsed_result: null,
    validation: { fallo: paraGuardar(x.fallo) } as unknown, ai_model: x.model, ai_latency_ms: x.latencyMs, status: 'failed',
  }).select('id').single();
  if (error) { console.error('[ocr-albaran] no se ha guardado el fallo:', error.message); return null; }
  return data.id as string;
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

// ── E10 · La factura larga, en dos pasos ────────────────────────────────────

function aB64(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

/** Cada página de un PDF, como un PDF de una página. */
async function partirPdf(bytes: Uint8Array): Promise<Uint8Array[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out: Uint8Array[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const una = await PDFDocument.create();
    const [pagina] = await una.copyPages(doc, [i]);
    una.addPage(pagina);
    out.push(await una.save());
  }
  return out;
}

/** Lo que sigue después de contestar (EdgeRuntime.waitUntil). Fuera de Supabase, se espera. */
function enSegundoPlano(p: Promise<unknown>): Promise<unknown> | null {
  const seguro = p.catch((e) => console.error('[ocr-albaran] líneas en segundo plano:', String(e)));
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(seguro); return null; }
  return seguro;
}

/**
 * Guarda las líneas en la sesión y en su factura (conta_lectura_lineas_guardar). Al leerla
 * por primera vez, la factura se crea justo después de contestar: si aún no está, se espera
 * y se vuelve a guardar (la base las pone de la sesión si la crea después).
 */
async function guardarLineas(sb: Sb, sesion: string, lineas: LineaLeida[], validacion: unknown, esperarFactura: boolean): Promise<{ facturas: number; lineas: number } | null> {
  const veces = esperarFactura ? 4 : 1;
  for (let i = 0; i < veces; i++) {
    const { data, error } = await sb.rpc('conta_lectura_lineas_guardar', { p_session: sesion, p_lineas: lineas, p_validacion: validacion });
    if (error) { console.error('[ocr-albaran] guardar las líneas:', error.message); return null; }
    const r = data as { facturas: number; lineas: number };
    if (r.facturas > 0 || i === veces - 1) return r;
    await new Promise((ok) => setTimeout(ok, 15_000));
  }
  return null;
}

type Base = { sb: Sb; anthropicKey: string; model: string; accountId: string };
const llamarCon = (x: Base) => (bloques: unknown[], prompt: string) => leerConIa(x.anthropicKey, x.model, bloques, prompt);

/** Paso 2: las líneas por páginas, juntas, a la sesión y a su factura. Devuelve su estado. */
async function completarLineas(x: Base & {
  sesion: string; ficheros: Fichero[]; parsed: ParsedDoc; factura: unknown; esperadas: number | null; paginas: number | null
  faltan?: { paginas: number[]; lineas: LineaLeida[]; porPagina: { pagina: number; lineas: number }[] } | null; esperarFactura: boolean
}): Promise<EstadoLineas> {
  const desde = new Date().toISOString();
  const base = baseDeLaCabecera(x.parsed as unknown as Parameters<typeof baseDeLaCabecera>[0]);
  let r: { lineas: LineaLeida[]; estado: EstadoLineas };
  try {
    r = await leerLasLineas({ llamar: llamarCon(x), ficheros: x.ficheros, partirPdf, aB64, esperadas: x.esperadas, base, desde, faltan: x.faltan });
  } catch (e) {
    // No se ha podido partir: no se ha leído ninguna página nueva.
    console.error('[ocr-albaran] partir en páginas:', String(e));
    const previas = x.faltan?.lineas ?? [];
    const sinLeer = x.faltan?.paginas ?? Array.from({ length: x.paginas ?? 1 }, (_, i) => i + 1);
    r = { lineas: previas, estado: { estado: 'faltan', leidas: previas.length, esperadas: x.esperadas, paginas: x.paginas, sin_leer: sinLeer, por_pagina: x.faltan?.porPagina ?? [], cuadre: null, desde } };
  }
  const conLineas = { ...x.parsed, lines: r.lineas } as ParsedDoc;
  await guardarLineas(x.sb, x.sesion, r.lineas, { ...validate(conLineas), factura: x.factura, lineas: r.estado }, x.esperarFactura);
  return r.estado;
}

/**
 * Llegó cortada: la cabecera (siempre corta) y la sesión como siempre, para que la factura
 * entre ya con sus bases; las líneas, después de contestar.
 */
async function facturaLarga(x: Base & { esFactura: boolean; inputFiles: { path: string; bucket: string }[]; contentBlocks: unknown[]; ficheros: Fichero[]; t0: number; primera: unknown }): Promise<Response> {
  let cab: Awaited<ReturnType<typeof leerCabecera>>;
  try {
    cab = await leerCabecera(llamarCon(x), x.contentBlocks);
  } catch (e) {
    const fallo = falloDeExcepcion(e);
    const sesion_fallo = await guardarFallo(x.sb, { account_id: x.accountId, files: x.inputFiles, model: x.model, latencyMs: Date.now() - x.t0, fallo });
    return jsonResponse(502, { error: 'Fallo llamando a la IA', clase: fallo.clase, causa: fallo.causa, sesion_fallo });
  }
  if ('error' in cab) {
    const fallo = falloDeRespuesta(cab.status, cab.error);
    const sesion_fallo = await guardarFallo(x.sb, { account_id: x.accountId, files: x.inputFiles, model: x.model, latencyMs: Date.now() - x.t0, fallo });
    return jsonResponse(502, { error: 'Error del servicio de IA', detail: cab.error, clase: fallo.clase, causa: fallo.causa, sesion_fallo });
  }
  const latencyMs = Date.now() - x.t0;
  if (!cab.parsed || !cab.parsed.document || esCortada(cab.raw)) {
    const fallo = falloDeContenido(cab.raw, esCortada(cab.raw) ? null : cab.parsed) ?? falloDeContenido(x.primera, null)!;
    const sesion_fallo = await guardarFallo(x.sb, { account_id: x.accountId, files: x.inputFiles, model: x.model, latencyMs, fallo });
    return jsonResponse(422, { error: 'La IA no devolvió un albarán legible', raw: cab.raw, clase: fallo.clase, causa: fallo.causa, sesion_fallo });
  }
  const parsed = cab.parsed;
  const validation = validate(parsed);
  // Solo en modo factura (la guarda del E2b: Cocina, sin modo, nunca pasa por la lectura de facturas).
  const factura = x.esFactura ? leerFactura(parsed as unknown as LecturaModelo, { hoy: new Date().toISOString().slice(0, 10) }) : null;
  const lineas: EstadoLineas = { estado: 'leyendo', leidas: 0, esperadas: cab.esperadas, paginas: cab.paginas, sin_leer: [], por_pagina: [], cuadre: null, desde: new Date().toISOString() };
  const p1 = x.primera as { stop_reason?: unknown; usage?: unknown } | null;
  const kind = x.inputFiles.some(f => f.path.toLowerCase().endsWith('.pdf')) ? 'pdf' : 'photo';
  const { data: session, error: sessErr } = await x.sb.from('goods_receipt_ai_session').insert({
    account_id: x.accountId,
    kind,
    input_files: x.inputFiles as unknown,
    // La cabecera, y de la primera (la cortada) solo por qué paró y lo que gastó.
    raw_response: { ...(cab.raw as Record<string, unknown>), e10_primera: { stop_reason: p1?.stop_reason ?? null, usage: p1?.usage ?? null } } as unknown,
    parsed_result: parsed as unknown,
    validation: { ...validation, factura, lineas } as unknown,
    ai_model: x.model,
    ai_latency_ms: latencyMs,
    status: 'pending_review',
  }).select('id').single();
  if (sessErr) {
    console.error('[ocr-albaran] insert sesión:', sessErr.message);
    return jsonResponse(500, { error: 'No se pudo guardar la sesión', detail: sessErr.message });
  }
  const espera = enSegundoPlano(completarLineas({ ...x, sesion: session.id, parsed, factura, esperadas: cab.esperadas, paginas: cab.paginas, esperarFactura: true }));
  if (espera) await espera;
  return jsonResponse(200, {
    session_id: session.id, status: 'pending_review', parsed, validation, lines_extracted: 0, ai_model: x.model, ai_latency_ms: latencyMs, factura, lineas,
  });
}

/** «Leer las que faltan»: las páginas que no se leyeron (o todas, si la lectura se paró). */
async function releerLineas(x: Base & { sesion: string }): Promise<Response> {
  const { data: s, error } = await x.sb.from('goods_receipt_ai_session').select('id, input_files, parsed_result, validation')
    .eq('account_id', x.accountId).eq('id', x.sesion).maybeSingle();
  if (error) return jsonResponse(500, { error: error.message });
  if (!s) return jsonResponse(404, { error: 'Esa lectura no está.' });
  const v = (s.validation ?? {}) as { lineas?: EstadoLineas; factura?: unknown };
  const e = estadoVisto(v.lineas as EstadoLineas | undefined);
  if (!e) return jsonResponse(200, { lineas: null, texto: 'Esta factura se leyó entera de una vez: no le falta ninguna línea.' });
  if (e.estado === 'completas') return jsonResponse(200, { lineas: e });
  if (e.estado === 'leyendo') return jsonResponse(409, { error: 'Aún se están leyendo sus líneas: en un momento aparecen.' });
  const paths = ((s.input_files ?? []) as { path: string }[]).map((f) => f.path);
  const b = await bloquesDe(x.sb, paths);
  if ('error' in b) return jsonResponse(400, { error: b.error });
  const previas = ((s.parsed_result?.lines ?? []) as LineaLeida[]);
  const faltan = e.sin_leer.length > 0 ? { paginas: e.sin_leer, lineas: previas, porPagina: e.por_pagina } : null;
  const estado = await completarLineas({ ...x, ficheros: b.ficheros, parsed: s.parsed_result as ParsedDoc, factura: v.factura ?? null, esperadas: e.esperadas, paginas: e.paginas, faltan, esperarFactura: false });
  return jsonResponse(200, { lineas: estado });
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

  const { account_id, file_paths, medir_sesiones, modo } = body;
  const esFactura = modo === 'factura';
  if (!account_id) return jsonResponse(400, { error: 'Falta account_id' });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return jsonResponse(500, { error: 'Servicio de IA no configurado' });
  const model = Deno.env.get('VISION_MODEL') ?? DEFAULT_VISION_MODEL;

  if (medir_sesiones && medir_sesiones.length > 0) {
    return await medir(sb, anthropicKey, model, account_id, medir_sesiones);
  }
  // E10 · «Leer las que faltan» de una factura larga.
  if (esFactura && body.releer_lineas) {
    return await releerLineas({ sb, anthropicKey, model, accountId: account_id, sesion: body.releer_lineas });
  }
  if (!file_paths || file_paths.length === 0) return jsonResponse(400, { error: 'Faltan file_paths' });

  // ── 1) Leer fichero(s) de Storage como base64 ──
  const b = await bloquesDe(sb, file_paths);
  if ('error' in b) return jsonResponse(400, { error: b.error });
  const contentBlocks = b.blocks;
  const inputFiles = b.files;

  // S01d · Modo cuadro: las filas y si el capital suma lo aplazado; nada se guarda aquí.
  if (modo === 'cuadro') {
    const r = await leerConIa(anthropicKey, model, contentBlocks, PROMPT_CUADRO);
    if ('error' in r) return jsonResponse(502, { error: 'Error del servicio de IA', detail: r.error });
    const cuadro = comprobarCuadro(r.parsed);
    if ('error' in cuadro) return jsonResponse(422, { error: cuadro.error });
    return jsonResponse(200, { cuadro, ai_model: model });
  }

  // ── 2) Llamar a Opus visión ──
  const t0 = Date.now();
  let parsed: ParsedDoc | null = null;
  let rawResponse: unknown = null;
  try {
    const r = await leerConIa(anthropicKey, model, contentBlocks, esFactura ? buildPrompt() + PROMPT_FACTURA : buildPrompt());
    if ('error' in r) {
      // E02 · La clase y la causa (caída o este documento), y la sesión con qué falló.
      const fallo = falloDeRespuesta(r.status, r.error);
      const sesion_fallo = await guardarFallo(sb, { account_id, files: inputFiles, model, latencyMs: Date.now() - t0, fallo });
      return jsonResponse(502, { error: 'Error del servicio de IA', detail: r.error, clase: fallo.clase, causa: fallo.causa, sesion_fallo });
    }
    parsed = r.parsed;
    rawResponse = r.raw;
  } catch (e) {
    console.error('[ocr-albaran] error IA:', String(e));
    const fallo = falloDeExcepcion(e);
    const sesion_fallo = await guardarFallo(sb, { account_id, files: inputFiles, model, latencyMs: Date.now() - t0, fallo });
    return jsonResponse(502, { error: 'Fallo llamando a la IA', clase: fallo.clase, causa: fallo.causa, sesion_fallo });
  }
  const latencyMs = Date.now() - t0;

  // E10 · Cortada en modo factura (trae más líneas de las que caben en una respuesta): la
  // cabecera ahora y las líneas por páginas después. Lo que no llega cortado sigue igual.
  if (esFactura && esCortada(rawResponse)) {
    return await facturaLarga({ sb, anthropicKey, model, accountId: account_id, esFactura, inputFiles, contentBlocks, ficheros: b.ficheros, t0, primera: rawResponse });
  }

  if (!parsed || !parsed.document) {
    // E02 · Cortada (max_tokens), rechazada, sin JSON o sin el documento: este documento no se ha podido leer.
    // La condición es la de siempre: una lectura que hoy sale bien sigue saliendo igual.
    const fallo = falloDeContenido(rawResponse, parsed) ?? falloDeContenido(rawResponse, null)!;
    const sesion_fallo = await guardarFallo(sb, { account_id, files: inputFiles, model, latencyMs, fallo });
    return jsonResponse(422, { error: 'La IA no devolvió un albarán legible', raw: rawResponse, clase: fallo.clase, causa: fallo.causa, sesion_fallo });
  }

  // ── 3) Validación por base imponible ──
  const validation = validate(parsed);
  // D01 · modo factura: la lectura comprobada va dentro de la validación de la sesión.
  const lecturaFactura = esFactura ? leerFactura(parsed as unknown as LecturaModelo, { hoy: new Date().toISOString().slice(0, 10) }) : null;
  const validacionGuardada = lecturaFactura ? { ...validation, factura: lecturaFactura } : validation;

  // ── 4) Guardar la sesión IA (pending_review) ──
  const kind = inputFiles.some(f => f.path.toLowerCase().endsWith('.pdf')) ? 'pdf' : 'photo';
  const { data: session, error: sessErr } = await sb.from('goods_receipt_ai_session').insert({
    account_id,
    kind,
    input_files: inputFiles as unknown,
    raw_response: rawResponse as unknown,
    parsed_result: parsed as unknown,
    validation: validacionGuardada as unknown,
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
    ...(lecturaFactura ? { factura: lecturaFactura } : {}),
  });
});
