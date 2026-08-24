// src/modules/kitchen/components/ChannelBadges.tsx
//
// F6 del rediseño: en qué canales está cada producto, sin abrir la ficha.
// Era el hueco más caro de la lista — hasta ahora había que entrar producto a
// producto para saber si algo llega a Glovo.
//
// El chip dice lo que SABE Folvy (el override de canal), no lo que la
// plataforma esté sirviendo ahora mismo; el servicio lo explica en detalle.
// El color no viaja solo: cada chip lleva su `title`, y los estados se
// distinguen además por el relleno, no solo por el tono — un daltónico
// distingue "lleno" de "hueco" aunque no distinga verde de rojo.

import type { ChannelBadge } from '@/modules/kitchen/services/channelPublicationService'

const STATE_CLASS: Record<ChannelBadge['state'], string> = {
  published: 'bg-success-bg text-success border-success/30',
  paused: 'bg-danger-bg text-danger border-danger/30',
  none: 'bg-page text-text-secondary border-border-default',
}

const STATE_TITLE: Record<ChannelBadge['state'], string> = {
  published: 'con precio propio en este canal',
  paused: 'PAUSADO en este canal',
  none: 'sin precio propio: va al precio base, o no se vende ahí',
}

interface Props {
  badges: ChannelBadge[] | undefined
  className?: string
}

export default function ChannelBadges({ badges, className = '' }: Props) {
  if (!badges || badges.length === 0) return null
  return (
    <div className={`flex items-center gap-0.5 ${className}`} aria-label="Canales">
      {badges.map((b) => (
        <span
          key={b.channelId}
          title={`${b.name}: ${STATE_TITLE[b.state]}`}
          className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded border
            text-[10px] font-semibold leading-none select-none ${STATE_CLASS[b.state]}`}
        >
          {b.letter}
        </span>
      ))}
    </div>
  )
}
