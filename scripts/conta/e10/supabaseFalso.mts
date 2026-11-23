// scripts/conta/e10/supabaseFalso.ts
//
// E10 · Un supabase-js DE MENTIRA para servir ocr-albaran en local (scripts/conta/e10/servir.mts):
// el almacén lee los ficheros del disco (E10_FICHEROS: {ruta: fichero local}) y lo que la
// función escribe (la sesión que inserta y las líneas que guarda) se apunta en E10_ESCRITO, una
// línea JSON por escritura. Así se compara lo que guarda la función de main con lo que guarda la
// de la rama, con la misma respuesta del modelo (regla 31).

const ficheros: Record<string, string> = JSON.parse(Deno.env.get('E10_FICHEROS') ?? '{}')
const escrito = Deno.env.get('E10_ESCRITO') ?? ''
let n = 0

function apuntar(x: unknown) {
  if (escrito) Deno.writeTextFileSync(escrito, JSON.stringify(x) + '\n', { append: true })
}

function tabla(nombre: string) {
  let fila: unknown = null
  const q = {
    insert(r: unknown) { fila = r; return q },
    select() { return q },
    eq() { return q },
    in() { return q },
    is() { return q },
    not() { return q },
    limit() { return q },
    // E10b · Lo que lee ocr-albaran para saber si la empresa recibe la mercancía con Folvy: su llegada y su
    // ajuste de compras. E10_FOLVY=0: una empresa solo de Sumied; si no, con Folvy.
    then(ok: (r: { data: unknown; error: null }) => unknown) {
      const datos = nombre === 'document_inbox' ? [{ company_id: 'empresa-falsa' }]
        : nombre === 'company_purchase_setting' ? [{ receives_goods: Deno.env.get('E10_FOLVY') !== '0' }] : []
      return Promise.resolve({ data: datos, error: null }).then(ok)
    },
    async single() {
      n++
      const id = `sesion-${n}`
      apuntar({ que: 'insert', tabla: nombre, fila })
      return { data: { id }, error: null }
    },
    async maybeSingle() { return { data: null, error: null } },
  }
  return q
}

export function createClient() {
  return {
    storage: {
      from: () => ({
        async download(ruta: string) {
          const local = ficheros[ruta]
          if (!local) return { data: null, error: { message: `no está ${ruta}` } }
          const bytes = Deno.readFileSync(local)
          const tipo = local.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
          return { data: new Blob([bytes], { type: tipo }), error: null }
        },
      }),
    },
    from: tabla,
    async rpc(nombre: string, args: Record<string, unknown>) {
      apuntar({ que: 'rpc', nombre, args })
      const lineas = Array.isArray(args.p_lineas) ? args.p_lineas.length : 0
      return { data: { facturas: 1, lineas, casadas: 0 }, error: null }
    },
  }
}
