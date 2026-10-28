import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'

interface ShareButtonProps {
  title: string
  text?: string
}

export function ShareButton({ title, text }: ShareButtonProps) {
  const toast = useToast()
  const [sharing, setSharing] = useState(false)

  const share = async () => {
    const url = window.location.href
    setSharing(true)
    try {
      if (navigator.share) {
        await navigator.share({ title, ...(text ? { text } : {}), url })
        return
      }
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      toast.show('success', '作品链接已复制')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.show('error', '暂时无法分享，请复制浏览器地址')
    } finally {
      setSharing(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={sharing} onClick={() => void share()}>
      分享作品
    </Button>
  )
}
