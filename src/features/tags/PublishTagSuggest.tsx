/**
 * 发布页的标签候选（8.3a）。
 *
 * 作用不是「帮用户想标签」，而是让全站标签保持可聚合：
 * 作者手打「夜景」「夜 景」「夜景照片」会让同一主题碎成三个标签页。
 * 两种候选共用一套替换语义：
 *   · 有正在输入的词 → 按这个词做前缀匹配，点一下**只替换这个词**；
 *   · 没有正在输入的词（空输入或刚敲完空格）→ 给全站热门标签，点一下追加。
 * 已输入的标签不会再出现在候选里，到上限整块消失。
 */
import { useMemo } from 'react'
import { useTagSearchList, useTagSuggestions } from '@/hooks/useTags'
import { TAG_MAX_LENGTH } from '@/domain/tags'
import { parseTags } from '@/lib/search/normalize'

/** 没有正在输入的词时展示的热门标签数（与「最多 5 个」对齐，留一个位置给手打） */
const HOT_TAG_FALLBACK = 5

export interface PublishTagSuggestProps {
  /** 输入框里的整串标签（空格分隔） */
  value: string
  onChange: (next: string) => void
  /** 最多几个标签（与表单校验一致） */
  max?: number
}

export function PublishTagSuggest({ value, onChange, max = 5 }: PublishTagSuggestProps) {
  const current = useMemo(() => parseTags(value), [value])
  // 正在输入的那个词：末尾没有空格时才是「未完成的词」
  const trailingSpace = /\s$/.test(value)
  const tokens = value.split(/\s+/)
  const partial = trailingSpace || value.trim() === '' ? '' : (tokens[tokens.length - 1] ?? '').trim()

  const { items: matched } = useTagSuggestions(partial, {
    delay: 300,
    limit: 5,
    enabled: current.length < max && partial.length > 0 && partial.length <= TAG_MAX_LENGTH,
  })
  // 热门标签走「无 Provider」的列表 hook：发布页的这行候选不该为了 5 个按钮
  // 去要求一个 QueryClient（与 useTagSuggestions 同一取舍）。
  const hot = useTagSearchList('', HOT_TAG_FALLBACK + current.length)

  const full = current.length >= max
  const picked = new Set(current.map((tag) => tag.toLocaleLowerCase()))
  const source = partial
    ? matched
    : (hot.data ?? []).map((item) => ({ tag: item.tag, photoCount: item.photoCount }))
  const options = source
    .filter((item) => !picked.has(item.tag.toLocaleLowerCase()))
    .slice(0, HOT_TAG_FALLBACK)
  if (full || options.length === 0) return null

  const apply = (tag: string) => {
    const kept = trailingSpace || value.trim() === '' ? tokens.filter(Boolean) : tokens.slice(0, -1).filter(Boolean)
    const next = [...kept, tag].slice(0, max)
    onChange(`${next.join(' ')} `)
  }

  return (
    <div className="g-publish-tag-row" role="group" aria-label="标签候选">
      <span className="g-publish-tag-label">{partial ? '候选' : '热门'}</span>
      {options.map((item) => (
        <button
          key={item.tag}
          type="button"
          className="g-publish-tag-suggest"
          onClick={() => apply(item.tag)}
        >
          #{item.tag}
          <span className="g-search-suggest-meta"> · {item.photoCount}</span>
        </button>
      ))}
    </div>
  )
}
