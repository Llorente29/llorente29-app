// src/modules/conta/impuestos/Calendario.tsx
//
// I01b · P1 · Impuestos › Calendario (tablero 8, maqueta «Impuestos.png»).
//   · Las tres cifras de arriba: el plazo que toca, lo que hay que pagar (solo
//     lo calculado aquí, respuesta 3) y los presentados del año.
//   · La tabla del mes del próximo plazo: el nombre en palabras, el modelo y
//     las dos fechas debajo, el resultado, el estado como chip y una acción
//     por fila; los avisos en ámbar en la fila. Lo que se pasó de plazo sin
//     presentar, también, arriba de todo.
//   · «Lo siguiente»: los plazos de los meses de después.
//   · A la derecha, «Por qué te salen estos», con los nombres cortos de la
//     maqueta («Retenciones (111)», «Sociedades (200 y 202)»), lo que no le
//     sale («No te sale el 349: …») y «+ Añadir otro impuesto» (pide motivo;
//     queda quién y cuándo).
// Todos los modelos de la empresa salen con sus fechas; los que aún no se
// calculan aquí lo dicen (regla 7: el umbral ordena, no esconde).
//
// En el móvil la tabla no pierde los títulos de columna: cada fila es un
// bloque y cada dato lleva su título delante (impuestos.css).
//
// Las acciones de la cabecera del tablero («Revisar y presentar los de
// octubre») van en la cinta de la pestaña, como en el resto del esqueleto.

import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { rutaAnual, rutaImpuestos, rutaIvaPeriodo } from '@/config/navegacion'
import { Boton, Campo, Chip, Dialogo, Selector, Tarjeta, TarjetaCifra, Texto } from '@/modules/conta/diseno'
import { useEntradasEnCinta, useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { anadirImpuesto } from '@/modules/conta/services/impuestosService'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  cifraPago, cifraPlazo, cifraPresentados, lineaDeFila, loSiguiente, mesDeVentana, nombreDeFila, nombreDeOficina, noTeSale, porQueEnCorto, textoResultado,
  tituloVentana, vistaDeFila, type Calendario as DatosCalendario, type FilaCalendario,
} from './calendario'
import { useCalendario } from './useCalendario'
import { hoyDeLaPantalla } from './despacho/despacho'
import { baseDeDatos } from '@/services/versionApp'

export function Calendario({ companyId }: { companyId: string }) {
  // «Hoy»: el de verdad; `?hoy=` solo contra una base de pruebas (demo y capturas), como en el despacho.
  const { search } = useLocation()
  const { hoy, forzado } = useMemo(() => hoyDeLaPantalla(search, baseDeDatos().tipo !== 'pruebas'), [search])
  const { datos, error, recargar } = useCalendario(companyId, forzado ? hoy : undefined)
  const nivel = useNivel()

  // La cinta: «Revisar y presentar los de octubre» lleva a la primera que pide algo.
  const primera = datos?.filas.find((f) => f.se_calcula && vistaDeFila(f).accion && vistaDeFila(f).accion !== 'ver')
  const mes = datos ? mesDeVentana(datos) : null
  const gestiona = datos?.puede_gestionar ?? false
  useEntradasEnCinta(useMemo(() => ({
    impuestos: [
      ...(gestiona ? [{ id: 'impuestos.fuera', etiqueta: 'Ya presenté uno fuera · pegar CSV', a: `${rutaImpuestos('presentados')}?fuera=1` }] : []),
      ...(primera && mes ? [{ id: 'impuestos.revisar-mes', etiqueta: `Revisar y presentar los de ${mes}`, a: rutaIvaPeriodo(primera.ejercicio, primera.periodo), principal: true }] : []),
    ],
  }), [primera, mes, gestiona]))

  return (
    <div className="s-pantalla s-impuestos">
      <h1 className="cx-oculto">Impuestos · Calendario</h1>
      {error && (
        <Tarjeta titulo="No se ha podido leer el calendario" tono="falta" accion={<Boton onClick={recargar}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error}</p>
        </Tarjeta>
      )}
      {!error && !datos && <Tarjeta titulo="Leyendo tus impuestos…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
      {!error && datos && (
        <>
          <div className="s-impuestos-cifras">
            {[cifraPlazo(datos), cifraPago(datos), cifraPresentados(datos)].map((c) => (
              <TarjetaCifra key={c.etiqueta} etiqueta={c.etiqueta} tono={c.tono} texto={c.texto}>
                <span>{c.valor}</span>
                <span className="s-impuestos-cifra-apoyo">{c.apoyo}</span>
              </TarjetaCifra>
            ))}
          </div>
          <div className="s-impuestos-columnas">
            <div className="s-impuestos-principal">
              <TablaDelMes datos={datos} nivel={nivel} />
            </div>
            <aside className="s-impuestos-lado">
              <PorQue datos={datos} companyId={companyId} alCambiar={recargar} />
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

function TablaDelMes({ datos, nivel }: { datos: DatosCalendario; nivel: ReturnType<typeof useNivel> }) {
  const siguiente = loSiguiente(datos, nivel)
  return (
    <Tarjeta compacta titulo={tituloVentana(datos)}
      apoyo="Sumied calcula el IVA con tus libros y lo cuadra. Tú revisas y presentas. Si se domicilia, el plazo acaba 5 días antes: te avisamos con ese plazo.">
      {datos.filas.length === 0
        ? <p className="s-apoyo s-impuestos-vacio">No hay ningún plazo cerca. Lo siguiente sale abajo.</p>
        : (
          <table className="s-tabla s-impuestos-tabla s-impuestos-calendario">
            <thead>
              <tr><th scope="col">Impuesto</th><th scope="col" className="s-tabla-cifra">Resultado</th><th scope="col">En qué punto está</th><th scope="col"><span className="cx-oculto">Qué hacer</span></th></tr>
            </thead>
            <tbody>
              {datos.filas.map((f) => <Fila key={`${f.modelo}-${f.ejercicio}-${f.periodo}`} f={f} nivel={nivel} />)}
            </tbody>
          </table>
        )}
      {siguiente.length > 0 && (
        <div className="s-impuestos-siguiente">
          <h3 className="s-impuestos-subtitulo">Lo siguiente</h3>
          <ul>
            {siguiente.map((g) => (
              <li key={g.cuando + g.que}>
                <span className="s-impuestos-siguiente-cuando">{g.cuando}</span>
                <span className="s-impuestos-siguiente-que">{g.que}</span>
                <span className="s-impuestos-siguiente-nota">{g.nota}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tarjeta>
  )
}

function Fila({ f, nivel }: { f: FilaCalendario; nivel: ReturnType<typeof useNivel> }) {
  const v = vistaDeFila(f)
  const d = f.declaracion
  const nombre = nombreDeFila(f, nivel)
  // S02 · Las anuales, a la pantalla del año (calcular, comprobar, el fichero y «ya lo presenté fuera»).
  const ir = f.se_calcula ? rutaIvaPeriodo(f.ejercicio, f.periodo) : f.cadencia === 'annual' ? rutaAnual(f.ejercicio, f.modelo) : null
  return (
    <tr data-ambar={v.ambar ? 'si' : undefined}>
      <td data-titulo="Impuesto">
        {ir ? <Link to={ir} className="s-impuestos-nombre">{nombre}</Link> : <span className="s-impuestos-nombre">{nombre}</span>}
        <span className="s-tabla-apoyo">{lineaDeFila(f, nivel)}</span>
      </td>
      <td data-titulo="Resultado" className="s-tabla-cifra">
        {d?.importe !== null && d?.importe !== undefined && d.resultado
          ? <><span className="s-cifra">{d.resultado === 'zero' || d.resultado === 'no_activity' ? '0,00 €' : eurosExactos(d.importe)}</span><span className="s-tabla-apoyo">{textoResultado(d.resultado)}</span></>
          : <span className="s-apoyo">—</span>}
      </td>
      <td data-titulo="En qué punto está">
        {v.chip && <Chip tono={v.chip.tono}>{v.chip.texto}</Chip>}
        {v.frase && <span className="s-apoyo">{v.frase}</span>}
        {v.aviso && <span className="s-impuestos-aviso">{v.aviso}</span>}
      </td>
      <td data-titulo="Qué hacer" className="s-impuestos-accion">
        {ir && v.textoAccion ? <Link to={ir}>{v.textoAccion} →</Link> : null}
      </td>
    </tr>
  )
}

function PorQue({ datos, companyId, alCambiar }: { datos: DatosCalendario; companyId: string; alCambiar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  return (
    <Tarjeta titulo="Por qué te salen estos" apoyo="Salen solos con los datos de la empresa. No hay que configurar nada.">
      <ul className="s-impuestos-porque">
        {porQueEnCorto(datos.modelos).map((l) => (
          <li key={l.clave}>
            <strong>{l.titulo}</strong> · {l.porque}
          </li>
        ))}
      </ul>
      {datos.no_presenta.length > 0 && (
        <ul className="s-impuestos-porque s-apoyo">
          {noTeSale(datos.no_presenta).map((l) => <li key={l.clave}>{l.texto}</li>)}
        </ul>
      )}
      {hecho && <p className="s-impuestos-hecho" role="status">{hecho}</p>}
      {datos.puede_gestionar && datos.se_pueden_anadir.length > 0 && (
        <Boton variante="enlace" onClick={() => { setHecho(null); setAbierto(true) }}>+ Añadir otro impuesto</Boton>
      )}
      {abierto && (
        <DialogoAnadir datos={datos} companyId={companyId} alCerrar={() => setAbierto(false)}
          alAnadir={(texto) => { setAbierto(false); setHecho(texto); alCambiar() }} />
      )}
    </Tarjeta>
  )
}

function DialogoAnadir({ datos, companyId, alCerrar, alAnadir }: {
  datos: DatosCalendario; companyId: string; alCerrar: () => void; alAnadir: (texto: string) => void
}) {
  const opciones = datos.se_pueden_anadir.map((m) => ({ valor: m.modelo, texto: `${nombreDeOficina(m.modelo, undefined, m.nombre)} (${m.modelo})` }))
  const [modelo, setModelo] = useState(opciones[0]?.valor ?? '')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const anadir = async () => {
    if (!motivo.trim()) { setFallo('Escribe por qué: queda apuntado con tu nombre.'); return }
    setEnviando(true); setFallo(null)
    try {
      await anadirImpuesto(companyId, modelo, motivo.trim())
      const o = opciones.find((x) => x.valor === modelo)
      alAnadir(`Añadido: ${o?.texto ?? modelo}. Ya sale en el calendario con sus plazos, y queda apuntado que lo añadiste tú y por qué.`)
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Dialogo titulo="Añadir otro impuesto" alCerrar={alCerrar}
      explicacion="Si Sumied no te lo ha puesto es porque con los datos de la empresa no le sale. Dinos por qué lo presentas: queda apuntado con tu nombre."
      acciones={<><Boton onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" onClick={anadir} disabled={enviando}>{enviando ? 'Añadiendo…' : 'Añadir'}</Boton></>}>
      <Campo etiqueta="Impuesto">{(p) => <Selector {...p} valor={modelo} alCambiar={setModelo} opciones={opciones} />}</Campo>
      <Campo etiqueta="Por qué lo presentas" error={fallo ?? undefined}>
        {(p) => <Texto {...p} valor={motivo} alCambiar={setMotivo} placeholder="Ej.: este año compramos a un proveedor de Francia" />}
      </Campo>
    </Dialogo>
  )
}
