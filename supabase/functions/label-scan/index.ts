// supabase/functions/label-scan/index.ts
//
// C9 · Lote 1 §2 (04/09/2026). El destino del QR de las etiquetas.
// ============================================================================
// EL QR DE LA ETIQUETA apunta a `https://<tienda-de-la-marca>/e/<token>`, no a
// Supabase: el marketing no se pierde y el cliente ve el dominio de la marca.
// Vercel reescribe esa ruta hasta aqui (ver vercel.json), y aqui se devuelve un
// 302 DE VERDAD a la tienda.
//
// POR QUE NO SE HIZO COMO RUTA DEL SPA: habria que arrancar un bundle de ~7,8 MB
// para acabar redirigiendo. El encargo pide que para el cliente sea «exactamente
// lo mismo que hoy», y hoy el QR va directo a la tienda. Un 302 lo es; un SPA que
// carga y luego se va, no — y menos en el movil de alguien, en su casa, con la
// cobertura que tenga.
//
// POR QUE TAMPOCO UNA FUNCION SERVERLESS DE VERCEL: este repo no tiene `api/` ni
// dependencia de Vercel, y montarla obligaria a poner una clave de Supabase en
// Vercel. Un rewrite a esta edge function no necesita ningun secreto nuevo.
//
// INSENSIBLE A MAYUSCULAS, y esto no es un detalle: el QR emite la URL ENTERA
// en mayusculas para que el simbolo entre en modo alfanumerico y baje de version
// 4 a 3 (medido: 24,8 mm -> 21,8 mm de lado manteniendo ECC Q). Asi que lo que
// llega aqui es `/E/AZ3KP9QR7MXT`. El esquema y el dominio ya son insensibles
// por norma y por DNS; de la ruta se encargan los dos rewrites de vercel.json
// (/E/ y /e/), y del token, el upper() de aqui y el de label_scan_register.
//
// UN TOKEN DESCONOCIDO NO ROMPE NADA (requisito 6): se redirige igual, a la
// tienda del dominio por el que entro (`x-forwarded-host`), y no se escribe.
//
// Deploy: POR CI, nunca por MCP (regla 22). Y con --no-verify-jwt: lo abre el
// movil de un cliente, que no tiene sesion.

import { createClient } from "@supabase/supabase-js";

function destinoPorDefecto(req: Request): string {
  // El dominio por el que llego la peticion es la tienda de esa marca.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return host ? `https://${host}/` : "https://folvy.app/";
}

function redirigir(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      // Que no se cachee: el registro del escaneo tiene que llegar cada vez.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const respaldo = destinoPorDefecto(req);

  let token: string;
  try {
    const u = new URL(req.url);
    // Vercel manda el token como ?t=…; se acepta tambien /label-scan/<token>.
    token = (u.searchParams.get("t") ?? u.pathname.split("/").filter(Boolean).pop() ?? "")
      .trim()
      .toUpperCase();
  } catch {
    return redirigir(respaldo);
  }

  if (!token || token === "LABEL-SCAN") return redirigir(respaldo);

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const { data, error } = await sb.rpc("label_scan_register", { p_token: token });
    if (error) {
      // El cliente no puede pagar un fallo nuestro con una pantalla de error.
      console.warn("label-scan: fallo al registrar", error.message);
      return redirigir(respaldo);
    }
    return redirigir(typeof data === "string" && data.length > 0 ? data : respaldo);
  } catch (e) {
    console.warn("label-scan: excepcion", e instanceof Error ? e.message : String(e));
    return redirigir(respaldo);
  }
});
