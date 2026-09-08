import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { editLayout, orderedLayoutItems, type ScreenLayout } from '../lib/screen-layout'
import { remoteAction } from '../lib/remote'

export interface LayoutSection { id: string; title: string; items: { id: string; title: string }[] }

export function ScreenLayoutEditor({ sections, layout, onChange, onClose }: {
  sections: LayoutSection[]; layout: ScreenLayout; onChange(value: ScreenLayout): void; onClose(): void
}) {
  const [sectionIndex, setSectionIndex] = useState(0)
  const [row, setRow] = useState(-1)
  const [column, setColumn] = useState(0)
  const panel = useRef<HTMLElement>(null)
  const section = sections[sectionIndex] ?? sections[0]
  const preference = layout[section.id]
  const items = orderedLayoutItems(section.items, preference, item => item.id, true)
  const activate = (index: number, actionColumn = column) => {
    if (index === items.length) { const next = { ...layout }; delete next[section.id]; onChange(next); return }
    if (index === items.length + 1) { onClose(); return }
    const selected = items[index]
    if (!selected) return
    const next = editLayout(section.items, preference, selected.id, (['toggle', 'up', 'down'] as const)[actionColumn])
    onChange({ ...layout, [section.id]: next })
    setRow(next.order.indexOf(selected.id))
  }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const action = remoteAction(event)
      if (!action) return
      event.preventDefault()
      if (action === 'back') { onClose(); return }
      if (action === 'up') setRow(Math.max(-1, row - 1))
      else if (action === 'down') setRow(Math.min(items.length + 1, row + 1))
      else if (action === 'left' || action === 'right') {
        const delta = action === 'left' ? -1 : 1
        if (row === -1) { setSectionIndex(Math.max(0, Math.min(sections.length - 1, sectionIndex + delta))); setColumn(0) }
        else setColumn(Math.max(0, Math.min(2, column + delta)))
      } else if (action === 'select') { if (row === -1) setRow(0); else activate(row) }
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  }, [row, column, sectionIndex, layout, sections])
  useLayoutEffect(() => {
    const element = panel.current?.querySelector<HTMLElement>('[data-edit-focus="true"]')
    element?.focus()
    element?.scrollIntoView({ block: 'nearest' })
  }, [row, column, sectionIndex, layout])
  return <section class="screen-layout-backdrop" role="dialog" aria-modal="true" aria-label="Edit screens" ref={panel}>
    <div class="screen-layout-editor">
      <header><h1>Edit screens</h1><p>Saved for this profile on this TV. Keep at least one item visible.</p></header>
      <nav aria-label="Screen to edit">{sections.map((item, index) => <button type="button" class={sectionIndex === index ? 'is-selected' : ''}
        data-edit-focus={row === -1 && sectionIndex === index} onClick={() => { setSectionIndex(index); setRow(-1) }}>{item.title}</button>)}</nav>
      <div class="screen-layout-list">{items.map((item, index) => <div class="screen-layout-row" key={item.id}>
        <strong>{item.title}</strong>
        {[preference?.hidden.includes(item.id) ? 'Show' : 'Hide', 'Move up', 'Move down'].map((label, actionColumn) => <button type="button"
          data-edit-focus={row === index && column === actionColumn} onClick={() => { setColumn(actionColumn); activate(index, actionColumn) }}
          aria-label={`${label} ${item.title}`}>{label}</button>)}
      </div>)}</div>
      <footer><button type="button" data-edit-focus={row === items.length} onClick={() => activate(items.length)}>Reset this screen</button>
        <button type="button" data-edit-focus={row === items.length + 1} onClick={onClose}>Done</button></footer>
      <p>↑ ↓ Select row · ← → Choose action · OK Apply · Back Done</p>
    </div>
  </section>
}
