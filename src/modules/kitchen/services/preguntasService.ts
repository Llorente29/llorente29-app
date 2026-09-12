// src/modules/kitchen/services/preguntasService.ts
//
// Lo que lee el tablero 1 (la lista de preguntas). Una sola RPC,
// `modificadores_lista_preguntas`, y aquí sólo se pasa de snake a camel: ni un
// cálculo, ni un texto. El castellano vive en `lib/preguntasDeCocina.ts`.
//
// UN FALLO NO SE DEVUELVE COMO VACÍO. Si la RPC rechaza, esto lanza con el
// motivo y la pantalla lo enseña. Cero preguntas de una consulta denegada se
// lee como «no tienes ninguna pregunta», que es lo contrario de la verdad — y
// es exactamente lo que pasaría con la guarda de cuenta, que niega de verdad.
//
// LA RESPUESTA CADUCA SI CAMBIA LA CUENTA (regla 9 en el navegador). Si
// alguien cambia de cuenta con una consulta en vuelo, la que vuelve es de la
// cuenta vieja: pintarla sería enseñar datos de otro. `getPreguntas` recibe la
// cuenta que pidió y quien llama comprueba que sigue siendo la suya.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'
import type {
  Pregunta, MarcaConPreguntas, CifrasDePreguntas, FranjaDeExtras, Ventana,
  TipoDePregunta, AccionDePregunta,
} from '@/modules/kitchen/lib/preguntasDeCocina'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
}

type Rpc = (fn: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { message: string } | null }>

type Fila = Record<string, unknown>
const num = (v: unknown): number => (v == null ? 0 : Number(v))
const bool = (v: unknown): boolean => v === true
const str = (v: unknown): string => (v == null ? '' : String(v))

export interface LasPreguntas {
  cuentaPedida: string
  ventana: Ventana
  franja: FranjaDeExtras
  cifras: CifrasDePreguntas
  marcas: MarcaConPreguntas[]
  sinPlato: { preguntas: number; opciones: number; filas: Pregunta[] }
}

function aPregunta(f: Fila): Pregunta {
  return {
    id: str(f.id),
    nombre: str(f.nombre),
    tipo: str(f.tipo) as TipoDePregunta,
    dePago: bool(f.de_pago),
    min: num(f.min),
    max: num(f.max),
    obligatoria: bool(f.obligatoria),
    repetible: bool(f.repetible),
    activa: bool(f.activa),
    origen: str(f.origen),
    cedida: bool(f.cedida),
    editable: bool(f.editable),
    etiquetaVieja: bool(f.etiqueta_vieja),
    opciones: num(f.opciones),
    opcionesCobran: num(f.opciones_cobran),
    sinDecidir: num(f.sin_decidir),
    platos: num(f.platos),
    copias: num(f.copias),
    reglasDistintas: bool(f.reglas_distintas),
    accion: str(f.accion) as AccionDePregunta,
    marca: f.marca == null ? null : String(f.marca),
  }
}

export async function getPreguntas(accountId: string, dias = 30): Promise<LasPreguntas> {
  requireSupabase()
  const { data, error } = await (supabase!.rpc as unknown as Rpc)(
    'modificadores_lista_preguntas',
    { p_account_id: accountId, p_dias: dias },
  )
  if (error) throw new Error(`No se han podido leer las preguntas: ${error.message}`)
  if (data == null) throw new Error('No se han podido leer las preguntas: la consulta no ha devuelto nada.')

  const d = data as Fila
  const ventana = (d.ventana ?? {}) as Fila
  const franja = (d.franja ?? {}) as Fila
  const cifras = (d.cifras ?? {}) as Fila
  const sinPlato = (d.sin_plato ?? {}) as Fila

  return {
    cuentaPedida: accountId,
    ventana: {
      dias: num(ventana.dias),
      desde: str(ventana.desde),
      hasta: str(ventana.hasta),
    },
    franja: {
      vendidas: num(franja.vendidas),
      conQueLleva: num(franja.con_que_lleva),
      sinDecidir: num(franja.sin_decidir),
      desconocidas: num(franja.desconocidas),
      cedidas: num(franja.cedidas),
      propias: num(franja.propias),
    },
    cifras: {
      preguntas: num(cifras.preguntas),
      opciones: num(cifras.opciones),
      platosConPregunta: num(cifras.platos_con_pregunta),
      platosActivos: num(cifras.platos_activos),
      repetidasNombres: num(cifras.repetidas_nombres),
      repetidasPreguntas: num(cifras.repetidas_preguntas),
      extrasDistintos: num(cifras.extras_distintos),
      opcionesSinDecidir: num(cifras.opciones_sin_decidir),
      opcionesSinDecidirCobran: num(cifras.opciones_sin_decidir_cobran),
    },
    marcas: ((d.marcas ?? []) as Fila[]).map((m) => ({
      id: str(m.id),
      nombre: str(m.nombre),
      cedida: bool(m.cedida),
      preguntas: ((m.preguntas ?? []) as Fila[]).map(aPregunta),
    })),
    sinPlato: {
      preguntas: num(sinPlato.preguntas),
      opciones: num(sinPlato.opciones),
      filas: ((sinPlato.filas ?? []) as Fila[]).map(aPregunta),
    },
  }
}

/**
 * La respuesta sirve sólo si sigue siendo la cuenta que se pidió.
 * Quien llama compara con la cuenta activa AHORA, no con la de cuando pidió.
 */
export function siguenSiendoDeEstaCuenta(r: LasPreguntas, cuentaActiva: string | null): boolean {
  return cuentaActiva != null && r.cuentaPedida === cuentaActiva
}
