# izumi companion brand assets

This sub-brand keeps the original izumi mark and outlined wordmark unchanged. `companion` is a
quiet product descriptor set beneath the wordmark so the TV receiver remains visibly part of
izumi without presenting itself as the full client.

## Palette

| Token | Hex | Use |
|---|---|---|
| Aqua | `#5CEAD8` | mark gradient start |
| Sky | `#1FA6F0` | mark gradient midpoint |
| Indigo | `#4E63F5` | mark gradient end |
| Night | `#07111E` | launcher backgrounds |
| Paper | `#F4F8FF` | primary wordmark on dark |
| Mist | `#9CB1C6` | Companion descriptor on dark |

## Files

- `svg/izumi-companion-lockup-dark.svg` — color mark and light type for dark surfaces.
- `svg/izumi-companion-lockup-light.svg` — color mark and ink type for light surfaces.
- `steamgriddb/source-flat/` — the original izumi Steam/Steam Deck library artwork used as masters.
- `steamgriddb/flat/` — companion-branded capsule, hero, portrait, tile, background, and square artwork.
- `png/` — transparent lockup exports for documentation use.

Run `npm run brand` after editing the generator or the source izumi mark/wordmark. The descriptor
font is embedded so every SVG remains self-contained.

The Steam-style square artwork is used for the packaged application icon. There is no branded
launch or splash screen inside the application.

Do not recolor the mark, add a glow or shadow, move `companion` onto the primary baseline, or use
the sub-brand lockup in place of the normal izumi catalogue mark inside the browsing interface.
