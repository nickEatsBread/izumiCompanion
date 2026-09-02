export interface HeroArtworkLayer {
  key: string
  image?: string
  visible: boolean
}

export interface HeroArtworkLayers {
  current: HeroArtworkLayer
  previous?: HeroArtworkLayer
}

export function initialHeroArtwork(key: string, image?: string): HeroArtworkLayers {
  return { current: { key, image, visible: true } }
}

/** Queue replacement art without disturbing the last fully visible frame. The incoming image stays
 * hidden until its own load event promotes it, which prevents older TV engines from painting the
 * element's default full-opacity frame before a CSS animation begins. */
export function queueHeroArtwork(
  layers: HeroArtworkLayers,
  key: string,
  image?: string,
): HeroArtworkLayers {
  if (layers.current.key === key) return layers
  const previous = layers.current.visible ? layers.current : layers.previous
  return {
    current: { key, image, visible: !image },
    ...(previous?.image ? { previous: { ...previous, visible: true } } : {}),
  }
}

export function revealHeroArtwork(layers: HeroArtworkLayers, key: string): HeroArtworkLayers {
  if (layers.current.key !== key || layers.current.visible) return layers
  return { ...layers, current: { ...layers.current, visible: true } }
}

export function finishHeroArtworkTransition(layers: HeroArtworkLayers, key: string): HeroArtworkLayers {
  if (layers.current.key !== key || !layers.current.visible || !layers.previous) return layers
  return { current: layers.current }
}
