import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface GlobalErrorBoundaryProps {
  children: ReactNode
}

interface GlobalErrorBoundaryState {
  error: Error | null
}

/**
 * 全局错误边界：包住 Provider 以下全部（FRONTEND-WORK §6.6）。
 * 展示给用户的信息不含堆栈；错误日志用 console.error。
 */
export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  state: GlobalErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[GlobalErrorBoundary]', error, info.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="g-error-boundary-page">
          <h1 className="g-error-boundary-title">页面出错了</h1>
          <p className="g-error-boundary-desc">抱歉，页面遇到意外错误。你可以尝试刷新页面。</p>
          <button type="button" className="g-btn g-btn-primary" onClick={this.handleReload}>
            刷新页面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
