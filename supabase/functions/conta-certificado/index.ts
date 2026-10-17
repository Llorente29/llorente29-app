// supabase/functions/conta-certificado/index.ts
//
// I01a · 4 · GUARDAR UN CERTIFICADO DE HACIENDA (.p12 / .pfx).
//
// Recibe { cuenta_id, p12_base64, contrasena } con la sesión de quien lo sube.
//   1. Saca a la persona de su JWT (nunca del cuerpo).
//   2. Abre el .p12 con su contraseña EN MEMORIA y lo valida antes de nada
//      (_shared/certificados/leerP12.ts): la contraseña lo abre, trae clave
//      RSA y certificado, la clave corresponde al certificado y está en vigor.
//      Una clave mala se rechaza aquí y no meses después en una presentación
//      colgada (prueba mTLS del 17/10).
//   3. Lo guarda con el almacén (_shared/certificados/almacen.ts): hoy el
//      Vault. La base decide si se puede: solo un administrador de esa cuenta,
//      y con el Vault solo la cuenta de Foodint. Si no, devuelve el porqué.
//
// Nunca: ni el .p12 ni su contraseña se guardan (solo el certificado y la
// clave, cifrados en el almacén), y en el registro no sale nada del fichero:
// ni el cuerpo, ni cabeceras, ni el titular. Solo «guardado» o el motivo.
//
// verify_jwt = true (config.toml). Abrirlo para usar no se hace aquí: lo hace
// la pieza que llama a Hacienda (I01a · 6), con un token de un solo uso.

import forge from "npm:node-forge@1.3.1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { CertificadoNoVale, leerP12, TAMANO_MAXIMO } from "../_shared/certificados/leerP12.ts";
import { AlmacenNoDeja, AlmacenVault } from "../_shared/certificados/almacen.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function deBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, mensaje: "Solo se puede subir un certificado." }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const comoPersona = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: sesion } = await comoPersona.auth.getUser(jwt);
  const usuario = sesion?.user?.id;
  if (!usuario) return json({ ok: false, mensaje: "Tienes que entrar con tu usuario para subir un certificado." }, 401);

  let cuerpo: { cuenta_id?: unknown; p12_base64?: unknown; contrasena?: unknown };
  try {
    cuerpo = await req.json();
  } catch {
    return json({ ok: false, mensaje: "No ha llegado el certificado." }, 400);
  }
  const cuenta = typeof cuerpo.cuenta_id === "string" ? cuerpo.cuenta_id : "";
  const b64 = typeof cuerpo.p12_base64 === "string" ? cuerpo.p12_base64 : "";
  const contrasena = typeof cuerpo.contrasena === "string" ? cuerpo.contrasena : "";
  if (!/^[0-9a-f-]{36}$/i.test(cuenta)) return json({ ok: false, mensaje: "Falta la cuenta a la que va el certificado." }, 400);
  if (b64.length > Math.ceil(TAMANO_MAXIMO * 4 / 3) + 64) {
    return json({ ok: false, motivo: "grande", mensaje: "Ese fichero es demasiado grande para ser un certificado (.p12 o .pfx)." }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = deBase64(b64);
  } catch {
    return json({ ok: false, motivo: "ilegible", mensaje: "Ese fichero no es un certificado .p12 o .pfx que se pueda leer." }, 400);
  }

  try {
    const leido = leerP12(forge, bytes, contrasena);
    const guardado = await new AlmacenVault(createClient(SUPABASE_URL, SERVICIO)).guardar({
      usuario, cuenta, ficha: leido.ficha, material: leido.material,
    });
    console.log(JSON.stringify({ certificado: "guardado", id: guardado.id }));
    const f = leido.ficha;
    return json({
      ok: true,
      id: guardado.id,
      custodia: guardado.custodia,
      mensaje: `Guardado el certificado de ${f.titular}${f.nifCola ? ` (NIF acabado en ${f.nifCola})` : ""}, válido hasta el ${f.validoHasta.slice(0, 10).split("-").reverse().join("/")}.`,
    });
  } catch (e) {
    if (e instanceof CertificadoNoVale) {
      console.log(JSON.stringify({ certificado: "rechazado", motivo: e.motivo }));
      return json({ ok: false, motivo: e.motivo, mensaje: e.message }, 422);
    }
    if (e instanceof AlmacenNoDeja) {
      console.log(JSON.stringify({ certificado: "no_guardado", codigo: e.codigo }));
      return json({ ok: false, motivo: "almacen", mensaje: e.message }, e.codigo === "42501" ? 403 : 409);
    }
    console.log(JSON.stringify({ certificado: "fallo" }));
    return json({ ok: false, motivo: "fallo", mensaje: "No se ha podido guardar el certificado. No se ha guardado nada; vuelve a intentarlo." }, 500);
  }
});
