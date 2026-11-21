// supabase/functions/conta-gocardless-leer/paginas.ts
//
// G06 · Todo, por páginas: la API devuelve como mucho 1.000 filas por consulta, y leyendo de una vez la lectura solo veía
// 1.000 de las 1.536 fichas de QBO (los clientes de GoCardless de las demás salían «sin ficha», un día sí y otro no).
// Cada consulta va ordenada por su clave, para que ninguna fila salga en dos páginas ni en ninguna; se pide hasta que
// una página viene vacía (vale con cualquier tope del servidor).
export type Pedido = PromiseLike<{ data: unknown; error: { message: string } | null }>
export async function leerTodas<T>(pedir: (desde: number, hasta: number) => Pedido, que: string, pagina = 1000): Promise<T[]> {
  const out: T[] = []
  for (let desde = 0; ; ) {
    const { data, error } = await pedir(desde, desde + pagina - 1)
    if (error) throw new Error(`No se ha podido leer ${que}: ${error.message}`)
    const filas = (data ?? []) as T[]
    if (!filas.length) return out
    out.push(...filas)
    desde += filas.length
  }
}
