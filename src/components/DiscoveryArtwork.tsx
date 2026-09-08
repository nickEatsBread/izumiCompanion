import { useEffect, useState } from 'preact/hooks'
import { Film } from 'lucide-preact'
import type { CompanionMedia } from '../types'
import { isHomeImageReady, preloadHomeImage } from '../lib/home-image-cache'

export function DiscoveryTitle({ media }: { media: CompanionMedia }) {
  const [ready, setReady] = useState('')
  const [failed, setFailed] = useState('')
  const source = media.logoImage
  useEffect(() => {
    let active = true
    if (source) void preloadHomeImage(source, 'title').then(loaded => { if (active && loaded) setReady(source) })
    return () => { active = false }
  }, [source])
  const showLogo = source && source !== failed && (ready === source || isHomeImageReady(source, 'title'))
  return <div class="tv-discovery-title">
    <h1 class={showLogo ? 'discovery-sr-only' : ''}>{media.title}</h1>
    {showLogo && <img key={source} src={source} alt="" onError={() => setFailed(source)} />}
  </div>
}

export function DiscoveryArtwork({ media, hero = false }: { media: CompanionMedia; hero?: boolean }) {
  const [failed, setFailed] = useState<string[]>([])
  const landscape = media.backdrop && !failed.includes(media.backdrop) ? media.backdrop : ''
  const source = landscape || (media.poster && !failed.includes(media.poster) ? media.poster : '')
  return <div class={`${hero ? 'tv-discovery-art' : 'tv-discovery-tile-art'}${!landscape ? ' is-poster' : ''}`}>
    {source ? <img key={source} src={source} alt="" onError={() => setFailed(previous => [...previous, source])} />
      : <span class="tv-discovery-no-art"><Film size={hero ? 58 : 32} /><span>Artwork unavailable</span></span>}
  </div>
}
