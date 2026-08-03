import { useEffect } from 'react'

/**
 * Keyboard is the primary input for the console. Reviewers process cases in
 * long sittings and the mouse round trip is the whole cost.
 *
 * Single key shortcuts are ignored while focus is in a text control, otherwise
 * typing "jack" in the search box would scroll the table.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  )
}

interface Options {
  count: number
  selected: number
  onSelect: (index: number) => void
  onOpen: (index: number) => void
  onSearch?: () => void
}

export function useListKeyboardNav({ count, selected, onSelect, onOpen, onSearch }: Options) {
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      // "/" focuses search even from inside the table, but never from inside
      // another text field, where it is a literal slash.
      if (event.key === '/' && !isTypingTarget(event.target) && onSearch) {
        event.preventDefault()
        onSearch()
        return
      }

      if (isTypingTarget(event.target)) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur()
        return
      }

      if (count === 0) return

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          onSelect(Math.min(selected + 1, count - 1))
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          onSelect(Math.max(selected - 1, 0))
          break
        case 'Enter':
          event.preventDefault()
          onOpen(selected)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [count, selected, onSelect, onOpen, onSearch])
}
