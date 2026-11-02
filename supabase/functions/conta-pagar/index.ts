// supabase/functions/conta-pagar/index.ts
//
// B01 Revolut · PR 2b · LA FUNCIÓN QUE PAGA. La única que llega a pagar() de un
// banco (ProveedorPago): lo vigila tests/unit/modules/conta/pagos/unaSalida.test.ts.
//
// Con la sesión de la persona (verify_jwt). Lo que decide quién puede qué lo
// decide la base (la 1234 y la 1614): aquí se comprueba la llave (WebAuthn) y
// el PIN, se mandan los correos del código y se habla con el banco.
//
//   titular            el titular del IBAN, según el banco (VoP), para el panel
//   llave_opciones     reto de un solo uso para confirmar un lote con la llave
//   llave_confirmar    la firma de la llave → la segunda aprobación del lote
//   pin_confirmar      el PIN de pago → la segunda aprobación del lote
//   codigo_pedir       el código del correo (crear el PIN o activar una llave)
//   codigo_usar        comprobarlo
//   pin_crear          el PIN nuevo (pide el código usado)
//   llave_registrar_opciones / llave_registrar   activar la llave en este dispositivo
//   mandar             manda al banco un lote «listo»
//   estado             pregunta al banco por los pagos de un lote que esperan
//
// Nunca se escribe en un registro un PIN, un código, un reto, un IBAN entero ni
// un token: solo los cuatro últimos y los recuentos.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { MARCAS } from "../_shared/marcas.ts";
import { cuentaPuedeSalir, EN_LA_DEMO } from "../_shared/puerta.ts";
import {
  FalloLlave, cifrarPin, codigoNuevo, comprobarFirma, comprobarRegistro, deB64url, motivoPin, opcionesDeConfirmar, opcionesDeRegistrar,
  retoNuevo, salNueva, sha256Hex,
} from "../_shared/pagos/llave.ts";
import { iban4, type ProveedorPago } from "../_shared/pagos/proveedorPago.ts";
import { entornoDe, FalloRevolut } from "../_shared/revolut/cliente.ts";
import { proveedorPagoRevolut } from "../_shared/revolut/pago.ts";
import { COLUMNAS_CONEXION, tokenDeAcceso, type ConexionRevolut } from "../_shared/revolut/servidor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENTORNO = entornoDe(Deno.env.get("REVOLUT_ENTORNO"));
/** La clave con la que se cifra el PIN de pago (HMAC). Solo vive aquí: la base nunca la ve. */
const PIN_CLAVE = Deno.env.get("PAGO_PIN_CLAVE") ?? "";
/** Los dominios por los que se entra: los de las marcas y, en staging, los suyos (REVOLUT_DOMINIOS). */
const DOMINIOS = new Set([...Object.values(MARCAS).flatMap((m) => m.dominios), ...(Deno.env.get("REVOLUT_DOMINIOS") ?? "").split(",").map((x) => x.trim()).filter(Boolean)]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const mal = (texto: string, status = 200, extra: Record<string, unknown> = {}) => json({ ok: false, texto, ...extra }, status);
const uuid = (x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x) ? x : null;

/** La dirección de la página (la llave va atada a ella), solo si es de Sumied. */
function direccionDe(origen: unknown): { origen: string; rpId: string; marca: string } | null {
  try {
    const u = new URL(String(origen));
    if (u.protocol !== "https:" || !DOMINIOS.has(u.host)) return null;
    const m = Object.values(MARCAS).find((x) => x.dominios.includes(u.host));
    return { origen: `https://${u.host}`, rpId: u.hostname, marca: m?.id ?? "sumied" };
  } catch { return null; }
}
const mascara = (correo: string) => { const [a, d] = correo.split("@"); return d ? `${a.slice(0, 1)}•••@${d}` : "tu correo"; };
const hora = () => new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");

async function correo(to: string, template: string, marca: string, data: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}`, "x-internal-key": SERVICIO },
    body: JSON.stringify({ to, template, marca, data }),
  });
  if (r.status === 423) throw new Error("Los correos de los pagos aún están cerrados (el freno de los correos con marca): no se ha mandado el código. Pídele a Julio que abra «codigo_pago_conta» y «aviso_pago_conta».");
  if (!r.ok) throw new Error(`No se ha podido mandar el correo (${r.status}).`);
}

/** El reto que trae la respuesta de la llave (clientDataJSON.challenge). */
function retoDe(clientDataJSON: string): string {
  try { return String(JSON.parse(new TextDecoder().decode(deB64url(clientDataJSON))).challenge ?? ""); } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json() as Record<string, unknown>; } catch { /* vacío */ }
  const accion = String(b.accion ?? "");

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return mal("Tu sesión ha caducado. Vuelve a entrar.", 401);
  const yo = u.user.id;
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const dir = direccionDe(b.origen);
  const rpc = async <T>(cliente: typeof srv, f: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await cliente.rpc(f, args);
    if (error) throw new FalloLlave(error.message);
    return data as T;
  };

  try {
    switch (accion) {
      // ── La segunda aprobación con la llave ──
      case "llave_opciones": {
        const lote = uuid(b.lote); if (!lote) return mal("Falta el pago.", 400);
        if (!dir) return mal("Abre Sumied desde su dirección de siempre para usar tu llave.");
        const llaves = await rpc<{ credential_id: string; transports: string[] }[]>(srv, "conta_llaves_de", { p_user: yo, p_rp_id: dir.rpId });
        if (!llaves.length) return json({ ok: true, sin_llave: true, texto: "Este dispositivo no tiene tu llave. Usa tu PIN de pago, o activa tu llave aquí." });
        const { reto, huella } = await retoNuevo();
        const r = await rpc<{ reto: string }>(srv, "conta_pago_reto_crear", { p_user: yo, p_proposito: "confirmar", p_via: "llave", p_reto_huella: huella, p_lote: lote, p_correo_mascara: null });
        return json({ ok: true, reto: r.reto, opciones: opcionesDeConfirmar({ reto, rpId: dir.rpId, llaves }) });
      }
      case "llave_confirmar": {
        const reto = uuid(b.reto); const c = (b.credencial ?? {}) as Record<string, string>;
        if (!reto || !c.id || !c.authenticatorData || !c.clientDataJSON || !c.signature) return mal("La llave no ha mandado su firma. Vuelve a pulsar el botón.", 400);
        if (!dir) return mal("Abre Sumied desde su dirección de siempre para usar tu llave.");
        const k = await rpc<{ id: string; public_key: string } | null>(srv, "conta_llave_de", { p_user: yo, p_credential_id: c.id, p_rp_id: dir.rpId });
        if (!k) return mal("Esa llave no es tuya o ya no está activa en Sumied. Usa tu PIN de pago.");
        const challenge = retoDe(c.clientDataJSON);
        const { signCount } = await comprobarFirma({ authenticatorData: c.authenticatorData, clientDataJSON: c.clientDataJSON, signature: c.signature, reto: challenge, origen: dir.origen, rpId: dir.rpId, publicKey: k.public_key });
        const usada = await rpc<{ ok: boolean; porque?: string }>(srv, "conta_llave_usada", { p_llave: k.id, p_sign_count: signCount });
        if (!usada.ok) return mal(usada.porque ?? "Esa llave ya no vale.");
        const r = await rpc<Record<string, unknown>>(srv, "conta_pago_reto_usar", { p_reto: reto, p_user: yo, p_reto_huella: await sha256Hex(challenge), p_dispositivo: String(b.dispositivo ?? "").slice(0, 80) || null });
        return json({ ...r, texto: r.frase ?? r.porque });
      }
      // ── La segunda aprobación con el PIN ──
      case "pin_confirmar": {
        const lote = uuid(b.lote); const pin = String(b.pin ?? ""); const huella = String(b.huella ?? "");
        if (!lote || !/^\d{6}$/.test(pin) || !/^[0-9a-f]{64}$/.test(huella)) return mal("Escribe tu PIN de pago: 6 cifras.", 400);
        const s = await rpc<{ sal: string; bloqueado: boolean } | null>(srv, "conta_pago_pin_sal", { p_user: yo });
        if (!s) return json({ ok: false, sin_pin: true, texto: "Todavía no tienes PIN de pago: créalo con el código del correo, o confirma con tu llave." });
        const r = await rpc<Record<string, unknown>>(srv, "conta_pago_pin_confirmar", { p_user: yo, p_lote: lote, p_pin_cifrado: await cifrarPin(pin, s.sal, PIN_CLAVE), p_huella_vista: huella, p_dispositivo: String(b.dispositivo ?? "").slice(0, 80) || null });
        if (r.aviso_correo && u.user.email) {
          try { await correo(u.user.email, "aviso_pago_conta", dir?.marca ?? "sumied", { que: "pin_bloqueado", cuando: hora() }); } catch (e) { console.error("[conta-pagar] aviso PIN bloqueado", e instanceof Error ? e.message : e); }
        }
        return json({ ...r, texto: r.frase ?? r.porque });
      }
      // ── El código del correo: crear el PIN o activar la llave ──
      case "codigo_pedir": {
        const para = b.para === "activar_llave" ? "activar_llave" : b.para === "crear_pin" ? "crear_pin" : null;
        if (!para) return mal("¿Para qué es el código?", 400);
        if (!u.user.email) return mal("Tu cuenta no tiene correo: no se puede mandar el código.");
        const codigo = codigoNuevo();
        const r = await rpc<{ reto: string }>(srv, "conta_pago_reto_crear", { p_user: yo, p_proposito: para, p_via: "codigo", p_reto_huella: await sha256Hex(codigo), p_lote: null, p_correo_mascara: mascara(u.user.email) });
        await correo(u.user.email, "codigo_pago_conta", dir?.marca ?? "sumied", { codigo, para, hora: hora() });
        return json({ ok: true, reto: r.reto, texto: `Te hemos mandado un código a ${mascara(u.user.email)}. Vale 10 minutos y una sola vez.` });
      }
      case "codigo_usar": {
        const reto = uuid(b.reto); const codigo = String(b.codigo ?? "").replace(/\s+/g, "");
        if (!reto || !/^\d{6}$/.test(codigo)) return mal("El código son 6 cifras.", 400);
        const r = await rpc<Record<string, unknown>>(srv, "conta_pago_reto_usar", { p_reto: reto, p_user: yo, p_reto_huella: await sha256Hex(codigo), p_dispositivo: null });
        return json({ ...r, texto: r.ok ? "Código bueno." : r.porque });
      }
      case "pin_crear": {
        const pin = String(b.pin ?? "");
        const motivo = motivoPin(pin); if (motivo) return mal(motivo);
        const sal = salNueva();
        const r = await rpc<{ nuevo: boolean; frase: string }>(srv, "conta_pago_pin_guardar", { p_user: yo, p_pin_cifrado: await cifrarPin(pin, sal, PIN_CLAVE), p_sal: sal });
        if (u.user.email) { try { await correo(u.user.email, "aviso_pago_conta", dir?.marca ?? "sumied", { que: r.nuevo ? "pin_creado" : "pin_cambiado", cuando: hora() }); } catch (e) { console.error("[conta-pagar] aviso PIN", e instanceof Error ? e.message : e); } }
        return json({ ok: true, texto: r.frase });
      }
      // ── Activar la llave en este dispositivo ──
      case "llave_registrar_opciones": {
        if (!dir) return mal("Abre Sumied desde su dirección de siempre para activar tu llave.");
        const { reto, huella } = await retoNuevo();
        const r = await rpc<{ reto: string }>(srv, "conta_pago_reto_crear", { p_user: yo, p_proposito: "registrar", p_via: "llave", p_reto_huella: huella, p_lote: null, p_correo_mascara: null });
        const ya = await rpc<{ credential_id: string }[]>(srv, "conta_llaves_de", { p_user: yo, p_rp_id: dir.rpId });
        const { data: nombre } = await sb.rpc("conta_nombre_actor");
        return json({ ok: true, reto: r.reto, opciones: opcionesDeRegistrar({ reto, rpId: dir.rpId, rpNombre: MARCAS[dir.marca as keyof typeof MARCAS]?.nombre ?? "Sumied", userId: yo, nombre: String(nombre ?? u.user.email ?? "Tú"), excluir: ya.map((k) => k.credential_id) }) });
      }
      case "llave_registrar": {
        const reto = uuid(b.reto); const c = (b.credencial ?? {}) as Record<string, unknown>;
        if (!reto || typeof c.attestationObject !== "string" || typeof c.clientDataJSON !== "string") return mal("La llave no ha mandado sus datos. Vuelve a pulsar «Activar mi llave».", 400);
        if (!dir) return mal("Abre Sumied desde su dirección de siempre para activar tu llave.");
        const challenge = retoDe(c.clientDataJSON);
        const k = await comprobarRegistro({ attestationObject: c.attestationObject, clientDataJSON: c.clientDataJSON, reto: challenge, origen: dir.origen, rpId: dir.rpId });
        const disp = String(b.dispositivo ?? "").slice(0, 80) || null;
        const transports = Array.isArray(c.transports) ? (c.transports as unknown[]).map(String).slice(0, 6) : [];
        const r = await rpc<{ frase: string }>(srv, "conta_llave_guardar", { p_user: yo, p_reto: reto, p_reto_huella: await sha256Hex(challenge), p_credential_id: k.credentialId, p_public_key: k.publicKey, p_algoritmo: k.algoritmo, p_sign_count: k.signCount, p_rp_id: dir.rpId, p_dispositivo: disp, p_transports: transports });
        if (u.user.email) { try { await correo(u.user.email, "aviso_pago_conta", dir.marca, { que: "llave", dispositivo: disp, cuando: hora() }); } catch (e) { console.error("[conta-pagar] aviso llave", e instanceof Error ? e.message : e); } }
        return json({ ok: true, texto: r.frase });
      }
      // ── Hablar con el banco ──
      case "titular":
      case "mandar":
      case "estado": {
        const empresa = uuid(b.empresa); if (!empresa) return mal("Falta la empresa.", 400);
        const { data: co } = await srv.from("company").select("id, account_id").eq("id", empresa).maybeSingle();
        if (!co) return mal("Esa empresa no existe.", 404);
        const quien = await rpc<{ yo_puedo: boolean; personas: { nombre: string }[] }>(sb, "conta_pago_quien", { p_company: empresa });
        if (!quien.yo_puedo) return mal(quien.personas.length ? `No tienes permiso para pagar. Pídeselo a ${quien.personas.map((p) => p.nombre).join(" o ")}, que puede pagar.` : "Nadie tiene todavía el permiso de pagar en esta empresa.", 403);
        // DM1: una cuenta de demostración no paga, ni pregunta al banco.
        if (!(await cuentaPuedeSalir(srv, co.account_id))) return json({ ok: false, demo: true, texto: `${EN_LA_DEMO} Una cuenta de demostración no paga.` });
        const { data: cx } = await srv.from("revolut_conexion").select(COLUMNAS_CONEXION).eq("company_id", empresa).maybeSingle();
        const conexion = cx as ConexionRevolut | null;
        if (conexion?.estado !== "conectada") return mal("Revolut no está conectado en esta empresa.");
        const banco: ProveedorPago & { estado(id: string, porRequestId?: boolean): ReturnType<ProveedorPago["estado"]> } =
          proveedorPagoRevolut(fetch, conexion.entorno, await tokenDeAcceso(srv, fetch, conexion)) as never;

        if (accion === "titular") {
          const factura = uuid(b.factura), cuenta = uuid(b.banco);
          if (!factura || !cuenta) return mal("Falta la factura o la cuenta.", 400);
          const p = await rpc<Record<string, unknown>>(sb, "conta_pago_preparar", { p_company: empresa, p_invoice: factura, p_treasury: cuenta });
          if (p.porque) return json({ ok: true, preparar: p });
          const t = await banco.comprobarTitular({ beneficiario: String(p.beneficiario), iban: String(p.iban) });
          console.log(`[conta-pagar] titular ${empresa.slice(0, 8)} ${iban4(String(p.iban))}: ${t.resultado}`);
          return json({ ok: true, preparar: p, titular: t });
        }

        const lote = uuid(b.lote); if (!lote) return mal("Falta el pago.", 400);
        if (accion === "mandar") {
          const m = await rpc<{ remesa: string; codigo: string; cuenta: string | null; banco: string; pagos: { salida: string; request_id: string; importe: number; beneficiario: string; iban: string; concepto: string }[] }>(srv, "conta_pago_mandar_empezar", { p_lote: lote });
          if (!m.cuenta) throw new Error("La cuenta de Revolut no está ligada: vuelve a ligarla en Bancos › Cuentas y extractos.");
          let bien = 0, mal_ = 0, dudosos = 0;
          for (const p of m.pagos) {
            try {
              const e = await banco.pagar({ requestId: p.request_id, cuentaOrigen: m.cuenta, beneficiario: p.beneficiario, iban: p.iban, importe: Number(p.importe), concepto: p.concepto });
              await rpc(srv, "conta_pago_banco_dice", { p_salida: p.salida, p_estado: e.estado, p_banco_id: e.bancoId, p_porque: "porque" in e ? e.porque : null });
              if (e.estado === "rechazada") mal_++; else bien++;
            } catch (e) {
              // Un «no» claro del banco (4xx) es un rechazo. Sin respuesta (red, 5xx), no se sabe:
              // se queda «enviando» y se pregunta por su request_id, sin mandarlo otra vez a ciegas.
              if (e instanceof FalloRevolut && e.status >= 400 && e.status < 500 && e.status !== 429) {
                await rpc(srv, "conta_pago_banco_dice", { p_salida: p.salida, p_estado: "rechazada", p_banco_id: null, p_porque: e.message });
                mal_++;
              } else { dudosos++; console.error(`[conta-pagar] mandar ${p.salida.slice(0, 8)}: sin respuesta clara (${e instanceof Error ? e.message : e})`); }
            }
          }
          console.log(`[conta-pagar] mandar ${lote.slice(0, 8)} (${m.codigo}): ${bien} bien, ${mal_} rechazados, ${dudosos} sin saber`);
          const n = m.pagos.length;
          const texto = mal_ === 0 && dudosos === 0
            ? `Enviado a ${m.banco}: ${n} ${n === 1 ? "pago" : "pagos"}. Te avisamos cuando lo confirme.`
            : `Enviado a ${m.banco}: ${bien} de ${n}. ${mal_ ? `${mal_} no ${mal_ === 1 ? "ha salido" : "han salido"}: mira el motivo en la factura. ` : ""}${dudosos ? `${dudosos} sin respuesta de ${m.banco} todavía: lo volvemos a preguntar, no se manda dos veces.` : ""}`.trim();
          return json({ ok: mal_ === 0, texto, bien, rechazados: mal_, sin_saber: dudosos, remesa: m.remesa });
        }
        // estado: lo que espera respuesta, por su id en el banco o por su request_id.
        const { data: pend } = await srv.from("conta_pago_salida").select("id, request_id, banco_id, estado").eq("lote_id", lote).in("estado", ["enviando", "enviada", "esperando_banco"]);
        let cambiados = 0;
        for (const p of pend ?? []) {
          try {
            const e = p.banco_id ? await banco.estado(p.banco_id) : await banco.estado(p.request_id, true);
            const r = await rpc<{ sin_cambio?: boolean }>(srv, "conta_pago_banco_dice", { p_salida: p.id, p_estado: e.estado, p_banco_id: e.bancoId, p_porque: "porque" in e ? e.porque : null });
            if (!r.sin_cambio) cambiados++;
          } catch (e) { console.error(`[conta-pagar] estado ${String(p.id).slice(0, 8)}: ${e instanceof Error ? e.message : e}`); }
        }
        return json({ ok: true, preguntados: (pend ?? []).length, cambiados });
      }
      default:
        return mal("No sé hacer eso.", 400);
    }
  } catch (e) {
    const texto = e instanceof FalloLlave || e instanceof FalloRevolut ? e.message : `No se ha podido: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`[conta-pagar] ${accion}: ${texto}`);
    return mal(texto);
  }
});
