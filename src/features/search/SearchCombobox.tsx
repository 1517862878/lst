/**
 * 搜索输入框 + 建议下拉（8.3a）。
 *
 * 为什么把建议做成 ARIA combobox 而不是「一排按钮」：
 *   · 用户在输入框里打字时手不离键盘，建议必须能用 ↑/↓/Enter 全程选中；
 *   · 屏幕阅读器要靠 role=combobox + aria-activedescendant 才知道
 *     「当前高亮的是第几条」，单纯把 div 高亮只会读出输入框的空值。
 *
 * 防抖 300ms（契约要求）：每按一键就发一次请求既浪费也会让下拉在
 * 输入过程中反复抖动；未聚焦或空输入时不下拉，也不发请求。
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useTagSuggestions } from '@/hooks/useTags'

export interface SearchComboboxProps {
  /** 受控初值（来自 URL 的 q）；URL 变化时同步进输入框 */
  initialQuery: string
  /** 提交关键词（写回 URL，并记入最近搜索） */
  onSubmitQuery: (term: string) => void
  /** 选中一个标签建议 */
  onPickTag: (tag: string) => void
  /** 外部请求的进行中状态（用于按钮 loading） */
  busy?: boolean
}

interface Option {
  id: string
  kind: 'query' | 'tag'
  label: string
  meta?: string
  run: () => void
}

export function SearchCombobox({ initialQuery, onSubmitQuery, onPickTag, busy = false }: SearchComboboxProps) {
  const listId = useId()
  const [input, setInput] = useState(initialQuery)
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // URL 是唯一事实来源：前进/后退或点「最近搜索」后输入框要跟上
  useEffect(() => setInput(initialQuery), [initialQuery])

  const trimmed = input.trim()
  const { items: tags, loading } = useTagSuggestions(trimmed, {
    delay: 300,
    limit: 6,
    enabled: focused && trimmed.length > 0,
  })

  const options = useMemo<Option[]>(() => {
    if (!trimmed) return []
    const list: Option[] = [
      {
        id: `${listId}-query`,
        kind: 'query',
        label: `搜索「${trimmed}」`,
        meta: '回车',
        run: () => onSubmitQuery(trimmed),
      },
    ]
    for (const suggestion of tags) {
      list.push({
        id: `${listId}-tag-${suggestion.tag}`,
        kind: 'tag',
        label: `#${suggestion.tag}`,
        meta: `${suggestion.photoCount} 件作品`,
        run: () => onPickTag(suggestion.tag),
      })
    }
    return list
  }, [trimmed, tags, listId, onSubmitQuery, onPickTag])

  const open = focused && options.length > 0
  const active = open && activeIndex >= 0 && activeIndex < options.length ? options[activeIndex] : undefined
  const activeId = active ? active.id : undefined

  // 选项数量变化后旧的高亮索引可能越界：夹回合法区间，避免「看不见的高亮」
  useEffect(() => {
    setActiveIndex((index) => (index >= options.length ? options.length - 1 : index))
  }, [options.length])

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }, [])

  const close = () => {
    setFocused(false)
    setActiveIndex(-1)
  }

  const runOption = (option: Option) => {
    option.run()
    close()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return
      event.preventDefault()
      setActiveIndex((index) => {
        if (event.key === 'ArrowDown') return index + 1 >= options.length ? 0 : index + 1
        return index <= 0 ? options.length - 1 : index - 1
      })
      return
    }
    if (event.key === 'Enter') {
      if (active) {
        // 有高亮项时 Enter 选高亮项，不提交表单（否则用户会同时触发两条搜索）
        event.preventDefault()
        runOption(active)
      }
      return
    }
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      close()
      return
    }
    // Tab 移出：收起下拉但保留焦点流转，不拦默认行为
    if (event.key === 'Tab') close()
  }

  return (
    <form
      className="g-search-bar"
      role="search"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmitQuery(trimmed)
        close()
      }}
    >
      <div className="g-search-combobox">
        <Input
          label="关键词"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current)
            setFocused(true)
          }}
          onBlur={() => {
            // 留一点时间让鼠标点中选项；选项本身也用 onMouseDown 兜底
            blurTimer.current = setTimeout(close, 120)
          }}
          onKeyDown={handleKeyDown}
          placeholder="搜索作品、用户或标签…"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
        />
        {open && (
          <ul id={listId} role="listbox" aria-label="搜索建议" className="g-search-suggestbox">
            {loading && <li className="g-search-suggest-head">正在查找建议…</li>}
            {options.map((option, index) => (
              <li
                key={option.id}
                id={option.id}
                role="option"
                aria-selected={index === activeIndex}
                className="g-search-suggest-option"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runOption(option)}
              >
                <span>{option.label}</span>
                {option.meta && <span className="g-search-suggest-meta">{option.meta}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button type="submit" loading={busy}>
        搜索
      </Button>
    </form>
  )
}
