// src/modules/supply/components/ConteoMovilPiezas.tsx
//
// LAS PIEZAS DE LAS PANTALLAS 1, 2 y 3 (maqueta aprobada el 10/09/2026).
//
// Salen de `MiAutoinventario.tsx` por la misma razón por la que salieron las de
// `PatronDeKitchen`: la CAPTURA que va al lado de la maqueta tiene que pintarse
// con estas piezas y no con un HTML escrito para la foto. Una foto que inventa
// su propio marcado enseña una pantalla que no existe, y eso ya se pagó una vez.
//
// Todo pinta con los tokens de `cocinaTokens.css`, que sólo existen dentro de
// `.cocina`. Fuera de esa clase sale sin color: es a propósito.

import { ChevronLeft, AlertTriangle, Loader2, Scale, Hash } from 'lucide-react'
import {
  formatDetail,
  fmtQty,
  type CountFormat,
} from '@/modules/supply/services/countFormatService'
import {
  FRACCIONES, unidadLarga, nombreDeEnvase, esFemenino, tituloAbierto,
  medida, pieDeLaCasilla, type Abierto,
} from '@/modules/supply/lib/conteoMovilTexto'
import '@/modules/kitchen/estilo/cocinaTokens.css'

export function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="cocina min-h-screen flex flex-col bg-cocina-fondo">
      {children}
    </div>
  )
}

/** El carril oscuro de la maqueta, con el progreso dentro. */
export function Cabecera({
  title, onBack, paso, de, pct,
}: { title: string; onBack?: () => void; paso?: number; de?: number; pct?: number }) {
  return (
    <div className="bg-cocina-tinta text-white px-4 pt-3.5 pb-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Volver"
              className="w-12 h-12 -ml-3 flex items-center justify-center text-cocina-carril-texto"
            >
              <ChevronLeft size={22} />
            </button>
          )}
          <span className="text-[15px] font-semibold truncate">{title}</span>
        </div>
        {paso != null && de != null && (
          <span className="num text-[13px] text-cocina-carril-texto whitespace-nowrap">{paso} de {de}</span>
        )}
      </div>
      {pct != null && (
        // #223037 sale de la maqueta (`.progress` del carril): es el único
        // color de este fichero que no tiene token, porque sólo vive aquí.
        <div className="h-1 rounded-sm overflow-hidden bg-[#223037]">
          <div className="h-1 bg-cocina-carril-marca transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-4 rounded-cocina-md border border-cocina-linea bg-cocina-superficie shadow-cocina flex flex-col overflow-hidden">
      {children}
    </div>
  )
}

export function Pie({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-6 flex flex-col gap-2.5 bg-cocina-fondo border-t border-cocina-linea">
      {children}
    </div>
  )
}

export function Centrado({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col items-center justify-center text-center px-6">{children}</div>
}

/** 56 px, el principal de la maqueta. */
export function BotonPrincipal({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-14 w-full rounded-cocina-md bg-cocina-acento text-white text-[16px] font-bold
                 inline-flex items-center justify-center gap-2 disabled:opacity-40 active:opacity-90"
    >
      {children}
    </button>
  )
}

/** 48 px, el de debajo. */
export function BotonSecundario({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-12 w-full rounded-cocina-md border border-cocina-linea bg-cocina-superficie
                 text-cocina-tinta-2 text-[15px] font-semibold disabled:opacity-40 active:opacity-90"
    >
      {children}
    </button>
  )
}

/** Una fila por formato: nombre, contenido, y − / cifra / + de 48 px. */
export function FilaFormato({
  formato, baseUnit, valor, rayada, tocado, onChange,
}: {
  formato: CountFormat
  baseUnit: string | null
  valor: number
  rayada: boolean
  /** ¿Se ha tecleado YA algo de este producto, en cualquier fila?
   *  Mientras no, la casilla enseña «–» y no «0»: vacío no es cero, que es lo
   *  mismo que dice `save_count_line` al negarse a tratar un array vacío como
   *  un recuento a cero. La maqueta lo hace igual — la pantalla 3, que llega
   *  con todo sin tocar, pone rayas; la 1, donde ya hay 2 bolsas puestas, pone
   *  el 0 de la caja, que ahí sí significa «ninguna caja». */
  tocado: boolean
  onChange: (n: number) => void
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3.5 py-3 min-h-[72px]
                     border-b border-cocina-linea-suave ${rayada ? 'bg-cocina-superficie-2' : ''}`}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[16px] font-bold text-cocina-tinta leading-tight">{formato.name}</span>
        <span className="text-[13px] text-cocina-tinta-3">{formatDetail(formato, baseUnit)}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Paso aria-label={`Quitar una ${formato.name}`} onClick={() => onChange(valor - 1)} disabled={valor <= 0}>−</Paso>
        <span className={`num w-10 text-center text-[22px] font-semibold ${valor > 0 ? 'text-cocina-tinta' : 'text-cocina-tinta-3'}`}>
          {valor === 0 && !tocado ? '–' : valor}
        </span>
        <Paso aria-label={`Añadir una ${formato.name}`} onClick={() => onChange(valor + 1)}>+</Paso>
      </div>
    </div>
  )
}

export function Paso({
  children, onClick, disabled, ...rest
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean } & { 'aria-label'?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...rest}
      className="w-12 h-12 rounded-cocina border border-cocina-linea bg-cocina-superficie
                 text-cocina-acento-ink text-[20px] font-semibold leading-none
                 disabled:opacity-30 active:bg-cocina-superficie-2"
    >
      {children}
    </button>
  )
}

/** La última fila: lo abierto. O báscula, o a ojo (pantalla 2). */
export function FilaAbierto({
  abierto, setAbierto, formatoRef, baseUnit, soloBase,
}: {
  abierto: Abierto
  setAbierto: (a: Abierto) => void
  formatoRef: CountFormat | null
  baseUnit: string | null
  soloBase: boolean
}) {
  const unidad = (baseUnit ?? 'ud')
  if (abierto.modo === 'peso') {
    return (
      <div className="flex flex-col gap-2.5 px-3.5 py-3 pb-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-[16px] font-bold text-cocina-tinta leading-tight">
              {soloBase ? '¿Cuánto hay?' : 'Abierto o suelto'}
            </span>
            <span className="text-[13px] text-cocina-tinta-3">
              {pieDeLaCasilla(baseUnit, soloBase)}
            </span>
          </div>
          {/* CAJA Y CAMPO FIJOS. Con el input a `w-full` la caja crecía hasta el
              ancho por defecto del control —unos 20 caracteres— y se salía de la
              tarjeta llevándose por delante la unidad de la derecha. Se vio en la
              captura a 390 px, no leyendo el código.
              MEDIDO EL 10/09 POR LA TARDE, y por eso ya no son 148/68: con 68 px
              cabían cuatro cifras y se recortaba la quinta —«12500» pedía 81 px—.
              Aceite Alto Oleico tiene 50.000 g de teórico y Bacon Ahumado 16.384:
              cinco y seis cifras son el día a día, no un caso raro. */}
          <label className="flex items-center gap-2 h-12 px-3 rounded-cocina border-2 border-cocina-acento
                            bg-cocina-superficie w-[176px] justify-between shrink-0">
            {/* Una bolsa no se pesa: el icono también lo dice. */}
            {medida(baseUnit).pesable
              ? <Scale size={20} className="text-cocina-acento shrink-0" />
              : <Hash size={20} className="text-cocina-acento shrink-0" />}
            <input
              /* `text` Y NO `number`. El `number` RECHAZA LA COMA —que es la tecla
                 decimal del teclado español— y deja el campo VACÍO sin decir nada:
                 quien escribe «12,5» ve desaparecer lo que ha tecleado. Medido en
                 el navegador el 10/09: value de «12,5» sale «». Con `text` la coma
                 se conserva y la convierte quien ya lo hacía, al construir la
                 entrada. `inputMode="decimal"` sigue sacando el teclado numérico. */
              type="text"
              inputMode="decimal"
              value={abierto.gramos}
              onChange={e => setAbierto({
                modo: 'peso',
                // Sólo cifras y separador: con `text` ya no filtra el navegador.
                gramos: e.target.value.replace(/[^\d.,]/g, ''),
              })}
              placeholder="–"
              aria-label={`Cantidad en ${medida(baseUnit).largo}`}
              className="num w-[96px] min-w-0 text-right text-[22px] font-semibold bg-transparent outline-none text-cocina-tinta"
            />
            <span className="text-[14px] text-cocina-tinta-3 shrink-0">{unidad}</span>
          </label>
        </div>
        {formatoRef && (
          <button
            type="button"
            onClick={() => setAbierto({ modo: 'ojo', formatId: formatoRef.id, fraccion: null, otros: '' })}
            className="self-start min-h-[48px] -my-2 text-[13px] font-semibold text-cocina-acento text-left"
          >
            {medida(baseUnit).pesable
              ? 'No tengo báscula: calcular a ojo'
              : 'Son muchas para contarlas: calcular a ojo'}
          </button>
        )}
      </div>
    )
  }

  // ── Pantalla 2 ──
  return (
    <div className="flex flex-col gap-2.5 px-3.5 py-3 pb-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          {/* LA FRASE DE LA MAQUETA, con la concordancia resuelta.
              «Bolsa abierta» y «Paquete abierto» salen de la misma regla que ya
              escribe bien «Bolsa cerrada» y «Paquete cerrado»: el género del
              envase, que es la PRIMERA palabra del nombre. Probada contra los
              24 nombres de formato que hay en el catálogo — y ahí es donde se
              ve que hace falta el tramo de los sufijos, porque «Unidad» no
              acaba en -a y es femenina.
              La cantidad de referencia va debajo, en gris: sin ella un «½» no
              dice de qué es la mitad. */}
          <span className="text-[16px] font-bold text-cocina-tinta leading-tight">
            {formatoRef ? `${tituloAbierto(formatoRef.name)}, a ojo` : 'Lo abierto, a ojo'}
          </span>
          <span className="text-[13px] text-cocina-tinta-3">
            {formatoRef ? `¿Cuánto queda en ${esFemenino(formatoRef.name) ? 'ella' : 'él'}?` : '¿Cuánto queda?'}
          </span>
          {formatoRef && (
            <span className="text-[12px] text-cocina-tinta-3">
              {nombreDeEnvase(formatoRef.name)} de {fmtQty(formatoRef.qtyInBase, baseUnit)}
            </span>
          )}
        </div>
        <span className="shrink-0 inline-flex items-center rounded-cocina bg-cocina-ambar-bg text-cocina-ambar
                         px-2 py-[3px] text-[11px] font-semibold">A ojo</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {FRACCIONES.map(f => {
          const activo = abierto.fraccion === f.v
          return (
            <button
              key={f.v}
              type="button"
              onClick={() => setAbierto({ ...abierto, fraccion: f.v, otros: '' })}
              className={`h-14 rounded-cocina border flex flex-col items-center justify-center gap-0.5 ${
                activo
                  ? 'border-cocina-acento bg-cocina-acento-bg'
                  : 'border-cocina-linea bg-cocina-superficie'
              }`}
            >
              <span className={`num text-[17px] font-bold ${activo ? 'text-cocina-acento-ink' : 'text-cocina-tinta'}`}>{f.label}</span>
              <span className={`text-[11px] ${activo ? 'text-cocina-acento-ink' : 'text-cocina-tinta-3'}`}>{f.pie}</span>
            </button>
          )
        })}
        {/* «Otra · + bolsa», como la maqueta: lo que se teclea aquí son BOLSAS,
            no gramos. Es el caso de que haya más de una abierta, o de que la
            que hay no sea ni ¼ ni ½ ni ¾. Poner gramos aquí sería duplicar la
            báscula dentro de la pantalla que existe porque no hay báscula. */}
        <div className={`h-14 rounded-cocina border flex flex-col items-center justify-center px-1 ${
          abierto.otros.trim() !== '' ? 'border-cocina-acento bg-cocina-acento-bg' : 'border-cocina-linea bg-cocina-superficie'
        }`}>
          <input
            type="number"
            inputMode="decimal"
            step="0.25"
            value={abierto.otros}
            onChange={e => setAbierto({ ...abierto, otros: e.target.value, fraccion: null })}
            placeholder="Otra"
            aria-label={`Otra cantidad, en ${formatoRef ? nombreDeEnvase(formatoRef.name) + 's' : 'unidades'}`}
            className="num w-full text-center text-[15px] font-bold bg-transparent outline-none text-cocina-tinta
                       placeholder:font-semibold placeholder:text-cocina-tinta-2
                       placeholder:[font-family:var(--cocina-fuente)]"
          />
          <span className="text-[11px] text-cocina-tinta-3">
            + {formatoRef ? nombreDeEnvase(formatoRef.name) : unidad}
          </span>
        </div>
      </div>

      <p className="text-[13px] text-cocina-tinta-2 leading-[1.45]">
        Se guarda como <b className="font-bold">estimado</b> y el encargado lo verá marcado.
        Mejor pesarlo si hay báscula.
      </p>
      <button
        type="button"
        onClick={() => setAbierto({ modo: 'peso', gramos: '' })}
        className="self-start min-h-[48px] -my-2 text-[13px] font-semibold text-cocina-acento text-left"
      >
        {medida(baseUnit).pesable
          ? `Tengo báscula: escribir los ${medida(baseUnit).largo}`
          : 'Contarlas: escribir las unidades'}
      </button>
    </div>
  )
}

/**
 * Pantalla 3. La hoja de abajo, con las casillas VACÍAS.
 *
 * Vacías no por estética: ese recuento todavía NO está guardado (el servidor
 * devolvió `recount` y no selló la línea). Enseñar aquí lo que puso antes sería
 * pedirle que confirme en vez de que cuente, que es justo lo que pasó la noche
 * del peperoni.
 *
 * Y NO SE DICE CUÁNTO ESPERA FOLVY. Ni «te falta la mitad», ni una flecha.
 * «Esto no cuadra» es todo lo que se puede decir sin convertir el recuento en
 * un examen con la respuesta escrita en la pizarra.
 */
export function HojaVuelveAMirarlo({
  producto, formats, baseUnit, cuenta, setCuenta, abierto, setAbierto, formatoRef,
  hayAlgo, saving, error, onGuardar, onLoMismo,
}: {
  producto: string
  formats: CountFormat[]
  baseUnit: string | null
  cuenta: Record<string, number>
  setCuenta: React.Dispatch<React.SetStateAction<Record<string, number>>>
  abierto: Abierto
  setAbierto: (a: Abierto) => void
  formatoRef: CountFormat | null
  hayAlgo: boolean
  saving: boolean
  error: string
  onGuardar: () => void
  onLoMismo: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <div className="absolute inset-0 bg-cocina-tinta/55" />
      <div className="relative bg-cocina-superficie rounded-t-[14px] max-h-[92vh] overflow-y-auto pb-6">
        <div className="w-10 h-1 rounded-sm bg-cocina-linea mx-auto mt-2.5 mb-1" />

        <div className="px-4 pt-3 flex gap-3">
          <div className="w-11 h-11 shrink-0 rounded-cocina bg-cocina-ambar-bg flex items-center justify-center">
            <AlertTriangle size={22} className="text-cocina-ambar" />
          </div>
          <div className="min-w-0">
            <p className="text-[22px] font-extrabold tracking-[-.015em] text-cocina-tinta leading-tight">
              Vuelve a mirarlo
            </p>
            <p className="text-[14px] text-cocina-tinta-2 mt-1.5 leading-[1.45]">
              Esto no cuadra con el último recuento ni con lo que ha entrado desde entonces.
              Busca en la cámara, el congelador y la barra, y cuenta {producto ? <b>{producto}</b> : 'el producto'} otra vez.
            </p>
          </div>
        </div>

        <div className="mt-3.5">
          <Tarjeta>
            {formats.map((f, i) => (
              <FilaFormato
                key={f.id}
                formato={f}
                baseUnit={baseUnit}
                valor={cuenta[f.id] ?? 0}
                rayada={i % 2 === 1}
                tocado={hayAlgo}
                onChange={n => setCuenta(c => ({ ...c, [f.id]: Math.max(0, n) }))}
              />
            ))}
            <FilaAbierto
              abierto={abierto}
              setAbierto={setAbierto}
              formatoRef={formatoRef}
              baseUnit={baseUnit}
              soloBase={formats.length === 0}
            />
          </Tarjeta>
        </div>

        <p className="px-4 mt-3 text-[13px] text-cocina-tinta-3 leading-[1.45]">
          Si al volver a contar te sale lo mismo, se guarda así y el encargado lo revisa
          antes de darlo por bueno.
        </p>

        {error && (
          <div className="mx-4 mt-3 rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-rojo-bg text-cocina-rojo leading-[1.45]">
            {error}
          </div>
        )}

        <div className="px-4 pt-3 flex flex-col gap-2.5">
          <BotonPrincipal disabled={!hayAlgo || saving} onClick={onGuardar}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : null}
            Guardar el nuevo recuento
          </BotonPrincipal>
          <BotonSecundario disabled={saving} onClick={onLoMismo}>
            Lo he mirado bien: no queda nada
          </BotonSecundario>
        </div>
      </div>
    </div>
  )
}


/**
 * «¿1,01 kg?» — LA PREGUNTA DE LA CASILLA DE GRAMOS.
 *
 * Sale cuando en la casilla de peso hay un decimal y la unidad base es g o ml.
 * Ver `dudaDeKilos`, que es donde vive la regla.
 *
 * NO ES UN FRENO, y por eso no se parece a la pantalla de «vuelve a mirarlo»:
 * no dice que la cantidad sea rara, no compara con nada y no esconde ninguna
 * salida. Pregunta una unidad y ofrece las DOS lecturas escritas enteras, con
 * su equivalencia, para que se pueda elegir sin hacer la cuenta de cabeza.
 *
 * La lectura en kilos va de principal porque es la que hace la báscula, pero
 * «son gramos» está al lado, al mismo tamaño de dedo (48 px), no escondida en
 * una esquina: quien pesa 0,5 g de azafrán tiene que poder decirlo en un toque.
 */
export function HojaDeKilos({
  producto, frase, comoEsta, baseUnit, saving, onGrande, onPequeno,
}: {
  producto: string
  frase: string
  comoEsta: number
  baseUnit: string | null
  saving?: boolean
  onGrande: () => void
  onPequeno: () => void
}) {
  return (
    <div className="cocina fixed inset-0 z-50 flex flex-col justify-end bg-black/45">
      <div className="bg-cocina-fondo rounded-t-cocina-md border-t border-cocina-linea px-4 pt-5 pb-6">
        <div className="flex items-center gap-2 text-cocina-ambar">
          <Scale size={16} />
          <span className="text-[12px] font-bold uppercase tracking-[0.08em]">Comprueba la unidad</span>
        </div>

        <p className="mt-2.5 text-[22px] font-bold text-cocina-tinta leading-[1.2]">
          ¿{frase}?
        </p>
        <p className="mt-2 text-[14px] text-cocina-tinta-suave leading-[1.5]">
          Has escrito un número con decimales en la casilla de {unidadLarga(baseUnit)} de{' '}
          <b className="text-cocina-tinta">{producto.toLowerCase()}</b>. Las básculas de cocina
          marcan {baseUnit === 'ml' ? 'litros' : 'kilos'}, así que casi siempre es eso.{' '}
          <b className="text-cocina-tinta">La diferencia son mil veces.</b>
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          <BotonPrincipal disabled={saving} onClick={onGrande}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : null}
            Sí, son {frase}
          </BotonPrincipal>
          <BotonSecundario disabled={saving} onClick={onPequeno}>
            No, son {fmtQty(comoEsta, baseUnit)}
          </BotonSecundario>
        </div>
      </div>
    </div>
  )
}
