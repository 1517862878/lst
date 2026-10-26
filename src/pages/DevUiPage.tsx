import { useState } from 'react'
import { Camera } from 'lucide-react'
import { Container } from '@/components/layout/Container'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Skeleton } from '@/components/ui/Skeleton'
import { Avatar } from '@/components/ui/Avatar'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Tabs } from '@/components/ui/Tabs'
import { Dialog } from '@/components/ui/Dialog'
import { Card } from '@/components/ui/Card'
import { Divider } from '@/components/ui/Divider'
import { useToast } from '@/components/ui/useToast'

/** 组件画廊页（S1 交付物）：集中展示所有基础组件，兼作开发自检（FRONTEND-WORK §5 W1 验收路径） */
export function DevUiPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tab, setTab] = useState('a')

  return (
    <Container>
      <h1 className="g-page-title">组件画廊（开发自检页）</h1>
      <p className="g-page-subtitle">基础组件与布局组件集中展示，S1 验收用。</p>

      <h2 className="g-dev-section-title">1. 按钮 Button / IconButton</h2>
      <div className="g-dev-row">
        <Button>主要按钮</Button>
        <Button variant="secondary">次要按钮</Button>
        <Button variant="ghost">幽灵按钮</Button>
        <Button variant="danger">危险按钮</Button>
        <Button loading>加载中</Button>
        <IconButton icon={Camera} label="相机图标按钮" />
      </div>

      <h2 className="g-dev-section-title">2. 表单 Input / Textarea</h2>
      <div className="g-dev-row">
        <Input label="用户名" placeholder="输入用户名" required />
        <Input label="密码" type="password" error="密码不能为空" />
        <Input label="带提示的字段" hint="这是辅助说明" />
      </div>
      <div className="g-dev-row">
        <Textarea label="拍摄心得" placeholder="分享你的拍摄心得" showCount maxLength={500} />
      </div>

      <h2 className="g-dev-section-title">3. 徽标 Badge</h2>
      <div className="g-dev-row">
        <Badge tone="neutral">默认</Badge>
        <Badge tone="info">信息</Badge>
        <Badge tone="success">成功</Badge>
        <Badge tone="warning">警告</Badge>
        <Badge tone="danger">危险</Badge>
      </div>

      <h2 className="g-dev-section-title">4. 骨架屏 Skeleton</h2>
      <div className="g-dev-row">
        <Skeleton variant="text" width={120} />
        <Skeleton variant="circle" width={48} height={48} />
        <Skeleton variant="rect" width={200} height={100} />
      </div>

      <h2 className="g-dev-section-title">5. 头像 Avatar</h2>
      <div className="g-dev-row">
        <Avatar name="小明" size={32} />
        <Avatar name="小红" size={48} />
        <Avatar name="摄影家" size={64} />
      </div>

      <h2 className="g-dev-section-title">6. 空态与错误态 EmptyState / ErrorState</h2>
      <div className="g-dev-row">
        <EmptyState
          title="还没有作品"
          description="成为第一个分享作品的人吧。"
          actions={[{ label: '去发布', to: '/publish' }]}
        />
        <ErrorState title="加载失败" error={new Error('网络异常')} onRetry={() => {}} />
      </div>

      <h2 className="g-dev-section-title">7. 选项卡 Tabs</h2>
      <Tabs
        items={[
          { value: 'a', label: '作品', count: 24 },
          { value: 'b', label: '收藏' },
          { value: 'c', label: '喜欢' },
        ]}
        value={tab}
        onValueChange={setTab}
      />

      <h2 className="g-dev-section-title">8. 卡片 Card</h2>
      <div className="g-dev-row">
        <Card className="g-dev-card">普通卡片</Card>
        <Card interactive className="g-dev-card">
          可交互卡片（hover 抬升）
        </Card>
      </div>

      <h2 className="g-dev-section-title">9. 分隔线 Divider</h2>
      <Divider label="带标签的分隔线" />

      <h2 className="g-dev-section-title">10. 对话框 Dialog</h2>
      <div className="g-dev-row">
        <Button onClick={() => setDialogOpen(true)}>打开对话框</Button>
      </div>
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="确认操作"
        description="这是对话框描述文字。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => setDialogOpen(false)}>确认</Button>
          </>
        }
      >
        <p>对话框内容区域。支持焦点陷阱与 Esc 关闭。</p>
      </Dialog>

      <h2 className="g-dev-section-title">11. Toast 通知</h2>
      <ToastDemo />
    </Container>
  )
}

function ToastDemo() {
  const { show } = useToast()
  return (
    <div className="g-dev-row">
      <Button variant="secondary" onClick={() => show('info', '这是一条信息通知')}>
        显示信息
      </Button>
      <Button onClick={() => show('success', '操作成功')}>显示成功</Button>
      <Button variant="danger" onClick={() => show('error', '操作失败')}>
        显示错误
      </Button>
    </div>
  )
}

export default DevUiPage
