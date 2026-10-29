/**
 * 第 1 步尚未实现的仓储占位。
 *
 * 为什么不当成空实现返回假数据：
 *   静默返回 [] 或 null 会让页面看起来"正常但没内容"，
 *   排查时会误以为是数据问题而不是功能未实现。
 *   显式抛错能让问题立刻暴露。
 *
 * 第 2 步已完成鉴权（实现见 ./auth.ts）；剩下的写入、上传、搜索在这里逐个替换。
 */
import { AppError, type CommentRepository, type InteractionRepository } from '@/data/contracts'

const notImplemented = (feature: string) =>
  new AppError('STORAGE', `该功能尚未接入后端：${feature}（下一步实现）`)

export const apiInteractionRepository: InteractionRepository = {
  async listLikesByUser() {
    throw notImplemented('我的点赞列表')
  },
  async listFavoritesByUser() {
    throw notImplemented('我的收藏列表')
  },
  async listByUsername() {
    throw notImplemented('个人主页的喜欢 / 收藏列表')
  },
  async getLikeState() {
    throw notImplemented('点赞状态')
  },
  async getFavoriteState() {
    throw notImplemented('收藏状态')
  },
  async toggleLike() {
    throw notImplemented('点赞')
  },
  async toggleFavorite() {
    throw notImplemented('收藏')
  },
  async listLikesByPhoto() {
    throw notImplemented('作品点赞列表')
  },
  async listFavoritesByPhoto() {
    throw notImplemented('作品收藏列表')
  },
}

export const apiCommentRepository: CommentRepository = {
  async list() {
    throw notImplemented('评论列表')
  },
  async create() {
    throw notImplemented('发表评论')
  },
  async softRemove() {
    throw notImplemented('删除评论')
  },
  async setLocked() {
    throw notImplemented('关闭作品评论')
  },
}
