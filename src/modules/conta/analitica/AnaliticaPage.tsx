// src/modules/conta/analitica/AnaliticaPage.tsx
//
// S01 · Contabilidad › Definiciones › Analítica (inventario del paso 1, §4.2,
// aprobado por Julio). Los dos ejes que ya guardan los apuntes (el local y la
// marca) se encienden o se apagan por empresa, y se llaman como la empresa
// quiera («Proyecto», «Centro de coste»…).
//
// Apagado, el eje ni se pide ni se enseña (el asiento a mano, subir una
// factura, los bancos, el Mayor…), y la validación deja de pedir el local
// (0140). Lo guardado se queda: encenderlo otra vez lo enseña como estaba.
//
// Regla 8: cada cambio dice lo que ha pasado y qué cambia en las pantallas.

import { useCallback, useEffect, useState } from 'react'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Boton, Campo, Chip, Tarjeta, Texto } from '@/modules/conta/diseno'
import { guardarEje, leerEjes, type FilaEje, type IdEje } from '@/modules/conta/services/esqueletoService'
import { refrescarContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import { ErrorConReintento, TarjetaCargando, Vacio } from '@/modules/conta/ui/piezas'
import { CabeceraEntradaMovil, MarcoAjustes } from '@/modules/conta/ajustes/MarcoAjustes'
import { useAjustes } from '@/modules/conta/ajustes/contextoAjustes'

const EJES: { eje: IdEje; deSerie: string; plural: string; queGuarda: string; donde: string }[] = [
  { eje: 'local', deSerie: 'Local', plural: 'Locales', queGuarda: 'el local de cada apunte',
    donde: 'el asiento a mano, al subir una factura, en cada banco y tarjeta, y en el Mayor y la cuenta de resultados' },
  { eje: 'marca', deSerie: 'Marca', plural: 'Marcas', queGuarda: 'la marca de cada apunte', donde: 'el Mayor y el libro diario' },
]

// S01e: dentro del marco, como el plan y las tablas: «Definiciones» encima y
// «Analítica» de título, a la vista (antes solo para lectores de pantalla).
export default function AnaliticaPage() {
  return <MarcoAjustes entrada="analitica"><Analitica /></MarcoAjustes>
}

function Analitica() {
  const { movil } = useAjustes()
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const [filas, setFilas] = useState<FilaEje[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])

  useEffect(() => {
    if (!accountId || !activa) return
    let vivo = true
    leerEjes(accountId, activa.id).then((f) => { if (vivo) { setFilas(f); setError(null) } },
      (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, activa, vuelta])

  if (!activa) return <Vacio titulo="Aún no hay ninguna empresa." explicacion="Da de alta tu empresa y aquí decides su analítica." />
  return (
    <div className="s-pantalla s-pantalla-estrecha">
      {movil && <CabeceraEntradaMovil titulo="Analítica" antetitulo="Definiciones" atras={null} />}
      <p className="s-apoyo">
        Los apuntes pueden llevar el local y la marca. Aquí decides si en {activa.nombre} se piden y se enseñan, y cómo se llaman.
        Apagar uno de los dos no borra nada: lo guardado se queda y vuelve a salir si lo enciendes.
      </p>
      {error && <ErrorConReintento mensaje={error} reintentar={recargar} />}
      {!error && filas === undefined && <TarjetaCargando />}
      {!error && filas === null && (
        <Tarjeta titulo="La analítica aún no está en esta base">
          <p>Mientras, el local y la marca salen como siempre.</p>
        </Tarjeta>
      )}
      {!error && filas && accountId && EJES.map((x) => (
        <Eje key={x.eje} def={x} fila={filas.find((f) => f.eje === x.eje) ?? null} accountId={accountId} companyId={activa.id}
          alGuardar={() => { recargar(); refrescarContextoEsqueleto() }} />
      ))}
    </div>
  )
}

function Eje({ def, fila, accountId, companyId, alGuardar }: {
  def: (typeof EJES)[number]; fila: FilaEje | null; accountId: string; companyId: string; alGuardar: () => void
}) {
  const encendido = fila?.activo ?? false
  const [nombre, setNombre] = useState(fila?.nombre ?? def.deSerie)
  const [plural, setPlural] = useState(fila?.nombrePlural ?? (fila ? '' : def.plural))
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  const guardar = async (activo: boolean, que: 'encender' | 'apagar' | 'nombre') => {
    setGuardando(true); setHecho(null); setFallo(null)
    try {
      const f = await guardarEje(accountId, companyId, def.eje, { activo, nombre, nombrePlural: plural || null })
      setHecho(que === 'apagar'
        ? `«${f.nombre}» apagado: ya no se pide ni se enseña en ${def.donde}. Lo guardado se queda.`
        : que === 'encender'
          ? `«${f.nombre}» encendido: se pide y se enseña en ${def.donde}.`
          : `Guardado: ahora se llama «${f.nombre}»${f.nombrePlural ? ` («${f.nombrePlural}» en plural)` : ''}.`)
      alGuardar()
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }
  const cambiado = nombre.trim() !== (fila?.nombre ?? def.deSerie) || plural.trim() !== (fila?.nombrePlural ?? (fila ? '' : def.plural))

  return (
    <Tarjeta titulo={fila?.nombre ?? def.deSerie} apoyo={`Guarda ${def.queGuarda}. Sale en ${def.donde}.`}
      accion={<Chip tono={encendido ? 'seguro' : 'neutro'}>{encendido ? 'Encendido' : 'Apagado'}</Chip>}>
      <div className="s-fila-campos">
        <Campo etiqueta="Cómo se llama">{(p) => <Texto {...p} valor={nombre} alCambiar={setNombre} maxLength={40} />}</Campo>
        <Campo etiqueta="En plural" ayuda="Para las columnas y los totales.">{(p) => <Texto {...p} valor={plural} alCambiar={setPlural} maxLength={40} />}</Campo>
      </div>
      <div className="s-pie">
        {encendido
          ? <Boton variante="secundario" disabled={guardando} onClick={() => void guardar(false, 'apagar')}>Apagar</Boton>
          : <Boton disabled={guardando} onClick={() => void guardar(true, 'encender')}>Encender</Boton>}
        {encendido && <Boton variante="secundario" disabled={guardando || !cambiado} onClick={() => void guardar(true, 'nombre')}>Guardar el nombre</Boton>}
      </div>
      <div role="status" aria-live="polite">{hecho && <p className="s-hecho">{hecho}</p>}</div>
      {fallo && <p className="s-fallo" role="alert">{fallo}</p>}
    </Tarjeta>
  )
}
