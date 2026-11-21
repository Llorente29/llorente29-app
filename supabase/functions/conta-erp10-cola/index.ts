// supabase/functions/conta-erp10-cola/index.ts
//
// X10f (20/11) · LO VALIDADO SALE SOLO A ERP10. La despierta, cada minuto y solo si hay algo,
// conta_erp10_despertar (cron conta-erp10-despertar, con el cron_secret del Vault). Coge lo que le
// toca (conta_erp10_cola: lo validado de las empresas con la salida encendida y la prueba hecha, en el
// orden en que se validó) y lo saca con LA MISMA PIEZA que el botón de «Salida a ERP10»
// (_shared/erp10Sacar.ts y erp10Puerto.ts): armado desde la base, nada dos veces, si uno falla los
// demás siguen, y lo que ha entrado se apunta en la salida de Sumied. Cada envío dice «sola».
// Validar no espera a ERP10 ni falla por ERP10: esto va aparte.
//
// Lo que falla se queda en su envío con su motivo; la cola lo vuelve a coger a los 5 minutos, hasta
// tres veces en total; después, parado. Lo que no puede salir por la conexión (retención, una cuenta
// que no cabe…) se queda parado con su porqué desde el principio.
//
// Sin sesión: verify_jwt = false (config.toml) y la cabecera x-cron-secret tiene que ser CRON_SECRET,
// como los demás vigías. En el registro, solo recuentos (sin textos de ERP10: esos van a la base).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cuentaPuedeSalir } from "../_shared/puerta.ts";
import { leerLaBase, puertosDelServidor } from "../_shared/erp10Puerto.ts";
import { pasadaDeLaCola, type EnCola } from "../_shared/erp10Sacar.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Por pasada: ERP10 tarda unos segundos por factura y la función tiene su tope. */
const POR_PASADA = 20;
/** Si se acerca el tope de la función, lo que quede lo coge la pasada siguiente (al minuto). */
const TOPE_MS = 110_000;
const QUIEN = "Salida sola a ERP10";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  const dado = req.headers.get("x-cron-secret") ?? "";
  if (!esperado || dado !== esperado) return json({ error: "no autorizado" }, 401);

  const t0 = Date.now();
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  try {
    const r = await pasadaDeLaCola({
      pendientes: async (limite) => {
        const { data, error } = await srv.rpc("conta_erp10_cola", { p_limite: limite });
        if (error) throw new Error(`no se ha podido leer la cola: ${error.message}`);
        return (data ?? []) as EnCola[];
      },
      empresa: async (companyId, accountId) => {
        // En la demo no se escribe en ERP10 (la misma puerta que el botón).
        if (!(await cuentaPuedeSalir(srv, accountId))) return null;
        const puertos = await puertosDelServidor(srv, { accountId, companyId, quien: QUIEN, como: "sola", apuntaCon: srv });
        if (!puertos) return null;
        return { base: (mes) => leerLaBase(srv, companyId, mes), puerto: puertos };
      },
    }, { limite: POR_PASADA, tope: () => Date.now() - t0 > TOPE_MS, aviso: () => console.error("conta-erp10-cola · una empresa no ha podido salir (apuntado en sus envíos)") });
    console.log(`conta-erp10-cola · ${JSON.stringify(r)}`);
    return json(r);
  } catch (e) {
    console.error(`conta-erp10-cola · ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "no se ha podido sacar la cola" }, 500);
  }
});
