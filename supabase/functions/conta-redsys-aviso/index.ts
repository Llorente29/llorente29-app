// supabase/functions/conta-redsys-aviso/index.ts
//
// S01 · PR 1 · EL AVISO DEL BANCO (Redsys) cuando un cliente paga por el enlace
// de pago. Redsys lo manda a esta dirección (DS_MERCHANT_MERCHANTURL) en un
// formulario con tres campos: Ds_SignatureVersion, Ds_MerchantParameters y
// Ds_Signature.
//
//   · La firma se comprueba SIEMPRE, con la clave del comercio de la empresa
//     del pedido (HMAC SHA-256 sobre la clave que saca el 3DES del pedido:
//     _shared/redsysSumied.ts). Un aviso mal firmado se apunta
//     (conta_redsys_aviso) y no cobra nada.
//   · Autorizado (Ds_Response 0000–0099) y del comercio de la empresa: el cobro,
//     por el motor de la E1 (conta_enlace_pago_cobrado_redsys), una vez y sin
//     pasarse de lo pendiente. Denegado: se apunta y nada más.
//   · En producción solo cobra una empresa que Julio haya pasado a real
//     (REDSYS_COBRO_REAL) o un entorno de pruebas (REDSYS_PRUEBAS=si).
//   · Siempre contesta 200 a Redsys (si no, lo repite): lo que pasó queda
//     apuntado, no en la respuesta.
//
// verify_jwt = false (config.toml): lo llama el banco.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { autorizado, avisoValido, empresaEnReal, leerParametros, metodoRedsys } from "../_shared/redsysSumied.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ok = () => new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "usa POST" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const apuntar = (pedido: string | null, empresa: string | null, firma: boolean, p: Record<string, string> | null, resultado: string) =>
    srv.rpc("conta_redsys_aviso_apuntar", {
      p_pedido: pedido, p_empresa: empresa, p_firma_ok: firma, p_respuesta: p?.Ds_Response ?? null,
      p_importe: p?.Ds_Amount ? Number(p.Ds_Amount) / 100 : null, p_resultado: resultado,
      // Solo lo que sirve para revisar: nunca la tarjeta ni el titular.
      p_detalle: p ? { comercio: p.Ds_MerchantCode ?? null, terminal: p.Ds_Terminal ?? null, metodo: p.Ds_ProcessedPayMethod ?? null, fecha: p.Ds_Date ?? null, hora: p.Ds_Hour ?? null } : null,
    });

  let campos: URLSearchParams;
  try {
    const tipo = req.headers.get("content-type") ?? "";
    const texto = await req.text();
    campos = tipo.includes("application/json")
      ? new URLSearchParams(Object.entries(JSON.parse(texto) as Record<string, string>))
      : new URLSearchParams(texto);
  } catch { await apuntar(null, null, false, null, "aviso que no se puede leer"); return ok(); }

  const aviso = { version: campos.get("Ds_SignatureVersion"), parametros: campos.get("Ds_MerchantParameters"), firma: campos.get("Ds_Signature") };
  const p = aviso.parametros ? leerParametros(aviso.parametros) : null;
  const pedido = p?.Ds_Order ?? null;
  if (!p || !pedido) { await apuntar(null, null, false, p, "aviso sin pedido"); return ok(); }

  const { data: d } = await srv.rpc("conta_redsys_aviso_datos", { p_pedido: pedido });
  const datos = d as { empresa?: string; comercio?: string; clave?: string | null; cobra?: boolean } | null;
  if (!datos?.empresa) { await apuntar(pedido, null, false, p, "pedido que no es de Sumied"); return ok(); }
  if (!datos.clave || !(await avisoValido(datos.clave, aviso))) {
    console.error(`conta-redsys-aviso · ${pedido} · firma mal`);
    await apuntar(pedido, datos.empresa, false, p, "firma mal: no cobra");
    return ok();
  }
  if (!autorizado(p.Ds_Response)) { await apuntar(pedido, datos.empresa, true, p, `denegado por el banco (${p.Ds_Response ?? "sin respuesta"})`); return ok(); }

  const real = empresaEnReal(Deno.env.get("REDSYS_COBRO_REAL"), datos.empresa);
  const pruebas = (Deno.env.get("REDSYS_PRUEBAS") ?? "").trim().toLowerCase() === "si";
  if (!real && !pruebas) { await apuntar(pedido, datos.empresa, true, p, "la empresa aún no cobra por aquí: no se apunta"); return ok(); }

  const { data, error } = await srv.rpc("conta_enlace_pago_cobrado_redsys", {
    p_pedido: pedido, p_comercio: String(p.Ds_MerchantCode ?? ""), p_importe: Number(p.Ds_Amount ?? 0) / 100,
    p_metodo: metodoRedsys(p), p_autorizacion: p.Ds_AuthorisationCode ?? null,
  });
  if (error) {
    console.error(`conta-redsys-aviso · ${pedido} · ${error.message}`);
    await apuntar(pedido, datos.empresa, true, p, `no se ha podido apuntar el cobro: ${error.message}`);
    return ok();
  }
  const r = data as { hecho?: boolean; motivo?: string; apuntado?: number; sobra?: number };
  await apuntar(pedido, datos.empresa, true, p, r.hecho ? `cobrado: ${r.apuntado} €${r.sobra ? `, sobran ${r.sobra} €` : ""}` : `no cobra: ${r.motivo}`);
  console.log(JSON.stringify({ funcion: "conta-redsys-aviso", pedido, ...r }));
  return ok();
});
