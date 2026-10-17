// scripts/conta/i01/prueba-mtls/index.ts
//
// I01 · Prueba de arquitectura (Julio, 17/10): ¿puede una edge function de
// Supabase abrir una conexión con CERTIFICADO DE CLIENTE (mTLS) usando
// Deno.createHttpClient({ cert, key })?
//
// SOLO STAGING y SOLO UN RATO: la despliega, la usa y la borra el workflow
// .github/workflows/prueba-mtls-staging.yml. Vive en scripts/ y no en
// supabase/functions/ a propósito: si esta rama llegara a main, el despliegue
// automático de funciones no la vería.
//
// Llama ÚNICAMENTE a https://client.badssl.com/, el servicio público de
// pruebas de certificado de cliente de badssl.com. Nada de la AEAT.
// El certificado de prueba (público, de badssl.com) llega en secretos de la
// función, en base64, y no se imprime nunca: ni en la respuesta ni en el log.
//
// Modos (?modo=):
//   · con        → con el certificado de prueba;
//   · sin        → sin certificado;
//   · clave_rota → con el certificado y la clave alterada en un carácter, para
//                  ver si el mensaje de error arrastra la clave.

const DESTINO = 'https://client.badssl.com/'

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { 'Content-Type': 'application/json' } })
}

function desdeBase64(nombre: string): string {
  const v = Deno.env.get(nombre)
  if (!v) throw new Error(`Falta el secreto ${nombre}`)
  return new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0)))
}

/** Quita del texto cualquier tramo que parezca PEM o base64 largo: lo que salga
 *  de la función no puede llevar material de clave, aunque lo traiga un error. */
function limpio(texto: string): { texto: string; traiaMaterial: boolean } {
  const traiaMaterial = /-----BEGIN|[A-Za-z0-9+/=]{40,}/.test(texto)
  return { texto: texto.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '«PEM»').replace(/[A-Za-z0-9+/=]{40,}/g, '«…»').slice(0, 300), traiaMaterial }
}

Deno.serve(async (req) => {
  const token = Deno.env.get('PRUEBA_MTLS_TOKEN')
  if (!token || req.headers.get('x-prueba-mtls') !== token) return json({ error: 'no' }, 401)

  const modo = new URL(req.url).searchParams.get('modo') ?? 'sin'
  if (!['con', 'sin', 'clave_rota'].includes(modo)) return json({ error: 'modo' }, 400)

  const t0 = Date.now()
  let cliente: Deno.HttpClient | undefined
  try {
    if (modo !== 'sin') {
      const cert = desdeBase64('PRUEBA_MTLS_CERT_B64')
      let key = desdeBase64('PRUEBA_MTLS_KEY_B64')
      if (modo === 'clave_rota') {
        // Un carácter del cuerpo de la clave, a la mitad: la cabecera PEM queda bien.
        const i = Math.floor(key.length / 2)
        key = key.slice(0, i) + (key[i] === 'A' ? 'B' : 'A') + key.slice(i + 1)
      }
      cliente = Deno.createHttpClient({ cert, key })
    }
    const r = await fetch(DESTINO, cliente ? { client: cliente } : {})
    const cuerpo = await r.text()
    const titulo = (cuerpo.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').trim().slice(0, 80)
    // Solo números y el título de la página: nada del certificado.
    console.log(JSON.stringify({ prueba: 'mtls', modo, status: r.status, ms: Date.now() - t0 }))
    return json({ modo, ok: true, status: r.status, titulo, ms: Date.now() - t0 })
  } catch (e) {
    const err = e as Error
    const m = limpio(String(err?.message ?? err))
    console.log(JSON.stringify({ prueba: 'mtls', modo, error: err?.name ?? 'Error', ms: Date.now() - t0 }))
    return json({ modo, ok: false, error: err?.name ?? 'Error', mensaje: m.texto, mensaje_traia_material: m.traiaMaterial, ms: Date.now() - t0 })
  } finally {
    cliente?.close()
  }
})
