/**
 * 法律页七合一（关于/用户协议/隐私/版权/DMCA/许可/社区规范）。
 * ROADMAP §9：版权与开源合规；内容精简但条款齐备（G-9：无空缺条款）。
 */
import { Link } from 'react-router'
import { LegalDocument, LegalSection } from '@/features/legal/LegalDocument'
import { dataSource } from '@/data'

export function AboutPage() {
  const isApi = dataSource() === 'api'
  return (
    <LegalDocument title="关于本站" version="1.0" effectiveAt="2026-10-26">
      <LegalSection title="工科影展是什么">
        <p>
          工科影展是一个面向公众的摄影作品分享社区。你可以注册账号，发布拍摄的相片，
          附上拍摄地点与心得，与大家交流拍摄技巧与器材。
        </p>
      </LegalSection>
      <LegalSection title="当前状态">
        <p>
          {isApi ? (
            <>本网站当前处于<strong>在线测试阶段</strong>：账号与公开内容由本站服务器保存，部分写入功能仍在完善。</>
          ) : (
            <>本网站当前处于<strong>本地演示模式</strong>：所有数据仅保存在你的浏览器（IndexedDB），清除浏览数据即丢失。</>
          )}
        </p>
      </LegalSection>
      <LegalSection title="开源">
        <p>
          本项目代码开源（MIT License），完整计划见{' '}
          <Link to="/licenses">开源许可</Link> 页面。
        </p>
      </LegalSection>
    </LegalDocument>
  )
}

export function TermsPage() {
  const isApi = dataSource() === 'api'
  return (
    <LegalDocument title="用户协议" version="1.0" effectiveAt="2026-10-26">
      <LegalSection title="1. 服务说明">
        <p>工科影展提供摄影作品展示、评论、点赞、收藏、排行榜与学习教程服务。</p>
      </LegalSection>
      <LegalSection title="2. 账号">
        <p>
          {isApi
            ? '你需要注册账号才能发布作品与评论。请为本站设置独立密码，不要与其他网站共用。'
            : '你需要注册账号才能发布作品与评论。本地演示不会提供正式账号安全保证，请勿使用真实密码。'}
        </p>
      </LegalSection>
      <LegalSection title="3. 内容规范">
        <p>
          禁止发布违法、侵权、色情、暴力内容；禁止冒充他人。平台保留删除违规内容的权利。
        </p>
      </LegalSection>
      <LegalSection title="4. 作品授权">
        <p>你上传的作品版权归你所有，平台不取得所有权。具体授权条款：</p>
        <ul>
          <li>权利保留：作者对作品保留完整著作权。</li>
          <li>授予平台的许可：全球、非独占、免费的展示许可（站内展示、缩略图、榜单、搜索索引、备份），不得用于其他目的。</li>
          <li>明确排除：AI 训练、商业转授权、印刷出版、NFT——均需另行书面授权。</li>
          <li>可撤回：删除作品后平台在 30 天内移除线上与缓存副本。</li>
          <li>权利保证：你保证拥有著作权与必要的肖像权授权。</li>
        </ul>
      </LegalSection>
      <LegalSection title="5. 免责声明">
        <p>
          {isApi
            ? '本站仍处于在线测试阶段，服务可能调整或中断；请自行保留上传作品的原始文件。'
            : '本地演示数据只存于浏览器，平台不对清除浏览数据等原因导致的数据丢失承担责任。'}
        </p>
      </LegalSection>
    </LegalDocument>
  )
}

export function PrivacyPage() {
  const isApi = dataSource() === 'api'
  return (
    <LegalDocument title="隐私政策" version="1.1" effectiveAt="2026-10-27">
      {isApi ? (
        <LegalSection title="在线测试阶段的数据">
          <p>为提供账号与内容服务，本站服务器会处理你主动提交的账号资料、公开作品资料与登录会话令牌。</p>
          <p>浏览器会在 localStorage 中保存登录令牌与界面偏好；退出登录会移除登录令牌。</p>
        </LegalSection>
      ) : (
        <LegalSection title="本地演示数据">
          <p>本地演示不会上传数据，以下信息只存于你的浏览器：</p>
          <ul>
            <li><code>gy:session</code> —— 登录会话（localStorage）</li>
            <li><code>gy:prefs</code> —— 界面偏好（localStorage）</li>
            <li><code>gy-db</code> —— 作品/互动/评论等实体数据（IndexedDB）</li>
            <li><code>gy-assets</code> —— 你上传的图片（IndexedDB）</li>
          </ul>
          <p>清除浏览器数据即可完全删除上述信息。</p>
        </LegalSection>
      )}
      <LegalSection title="图片 EXIF 隐私">
        <p>
          上传图片时，我们只提取 7 项拍摄参数（机身/镜头/光圈/快门/ISO/焦距/时间），
          <strong>GPS 定位与设备序列号会被丢弃</strong>，永不存储、永不展示。
        </p>
      </LegalSection>
    </LegalDocument>
  )
}

export function CopyrightPage() {
  return (
    <LegalDocument title="版权声明" version="1.0" effectiveAt="2026-10-26">
      <LegalSection title="代码">
        <p>本站源代码以 MIT License 开源，详见 <Link to="/licenses">开源许可</Link>。</p>
      </LegalSection>
      <LegalSection title="用户作品">
        <p>
          用户上传的摄影作品著作权归原作者所有。默认<strong>保留所有权利</strong>；
          作者可在发布时选择 CC 授权。转载、使用他人作品须获得作者许可。
        </p>
      </LegalSection>
      <LegalSection title="教程内容">
        <p>学习板块教程文案采用 CC BY-SA 4.0 许可（署名 + 相同方式共享）。</p>
      </LegalSection>
      <LegalSection title="侵权投诉">
        <p>如认为本站内容侵犯你的权利，请通过 <Link to="/dmca">侵权投诉</Link> 页面联系我们。</p>
      </LegalSection>
    </LegalDocument>
  )
}

export function DmcaPage() {
  return (
    <LegalDocument title="侵权投诉（DMCA）" version="1.0" effectiveAt="2026-10-26">
      <LegalSection title="通知—删除流程">
        <p>
          如认为本站内容侵犯你的著作权，请发送包含以下信息的投诉：
        </p>
        <ul>
          <li>被侵权作品的描述与链接</li>
          <li>侵权内容的页面地址</li>
          <li>你的联系方式</li>
          <li>权利声明（你是权利人或有合法授权）</li>
        </ul>
      </LegalSection>
      <LegalSection title="处理时限">
        <p>收到有效通知后，我们将在 7 个工作日内核实并采取下架等措施。</p>
      </LegalSection>
    </LegalDocument>
  )
}

export function LicensesPage() {
  return (
    <LegalDocument title="开源许可" version="1.0" effectiveAt="2026-10-26">
      <LegalSection title="本项目代码">
        <p>
          采用 <strong>MIT License</strong>：允许自由使用、复制、修改、合并、发布、分发、
          再许可及销售软件副本，须保留版权声明。
        </p>
      </LegalSection>
      <LegalSection title="教程内容">
        <p>学习板块文案采用 <strong>CC BY-SA 4.0</strong>：可转载，但须署名并保持相同协议共享。</p>
      </LegalSection>
      <LegalSection title="第三方依赖">
        <p>主要依赖及其许可：React（MIT）、react-router（MIT）、TanStack Query（MIT）、Zustand（MIT）、Tailwind CSS（MIT）、Radix UI（MIT）、MiniSearch（MIT）、marked（MIT）、DOMPurify（Apache-2.0/MIT 双许可）、Vite（MIT）。完整清单见仓库 THIRD_PARTY_NOTICES。</p>
      </LegalSection>
    </LegalDocument>
  )
}

export function CommunityPage() {
  return (
    <LegalDocument title="社区规范" version="1.0" effectiveAt="2026-10-26">
      <LegalSection title="我们鼓励">
        <ul>
          <li>分享真实的拍摄经验与技巧</li>
          <li>友善、建设性的评论</li>
          <li>注明引用与出处</li>
        </ul>
      </LegalSection>
      <LegalSection title="我们禁止">
        <ul>
          <li>人身攻击、歧视与骚扰</li>
          <li>发布他人作品冒充自己</li>
          <li>刷赞、刷榜等破坏公平的行为</li>
          <li>广告与垃圾信息</li>
        </ul>
      </LegalSection>
    </LegalDocument>
  )
}
