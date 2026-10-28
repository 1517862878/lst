import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { Avatar } from '@/components/ui/Avatar'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import { useSession } from '@/hooks/useSession'
import { usePhotosByUser } from '@/hooks/usePhotos'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { accountImageUrl } from '@/lib/account'

export function MePage(){return <RequireAuth><MeInner/></RequireAuth>}
function MeInner(){
 const {data:session}=useSession(), works=usePhotosByUser(session?.userId??'','works'), favorites=usePhotosByUser(session?.userId??'','favorites'), likes=usePhotosByUser(session?.userId??'','likes')
 const username=session?.username??''
 return <Container><div className="g-dashboard-heading"><Avatar src={accountImageUrl(session?.avatarKey)} name={session?.displayName||username} size={64}/><PageHeader title="我的工作台" description={`欢迎回来，${session?.displayName||`@${username}`}`}/></div>
  <div className="g-me-stats" aria-label="账号概览"><div><strong>{works.data?.length??0}</strong><span>作品</span></div><div><strong>{favorites.data?.length??0}</strong><span>收藏</span></div><div><strong>{likes.data?.length??0}</strong><span>喜欢</span></div></div>
  <nav className="g-me-menu" aria-label="我的快捷入口"><Link to="/publish" className="g-me-item"><span className="g-me-item-title">发布作品</span><span className="g-me-item-desc">上传相片与心得</span></Link><Link to={`/u/${username}`} className="g-me-item"><span className="g-me-item-title">查看个人主页</span><span className="g-me-item-desc">作品、喜欢与收藏</span></Link><Link to="/settings/profile" className="g-me-item"><span className="g-me-item-title">设置与隐私</span><span className="g-me-item-desc">资料、隐私、设备与账号安全</span></Link></nav>
  <section className="g-me-section"><h2>最近作品</h2><PhotoGrid photos={(works.data??[]).slice(0,4)} loading={works.isLoading} error={works.error} onRetry={()=>void works.refetch()} emptyTitle="还没有作品" emptyActions={[{label:'发布第一件作品',to:'/publish'}]}/></section>
 </Container>
}
