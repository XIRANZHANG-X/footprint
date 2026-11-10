import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error: Error | null; exporting: boolean; note: string | null }

// 界面任何一处渲染出错时，React 会把整页卸掉，只剩白屏。
// 这里接住错误，告诉用户数据还在，并给出两条出路：重新打开、先导出备份（决策 0011）
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, exporting: false, note: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('界面出错', error, info.componentStack)
  }

  // 备份代码按需加载：正常使用时不占首屏体积；它不依赖出错的界面，只读数据库
  exportBackup = async () => {
    this.setState({ exporting: true, note: null })
    try {
      const [{ exportBackup }, { saveFile }] = await Promise.all([
        import('../lib/backup.ts'),
        import('../lib/saveFile.ts'),
      ])
      const { blob, name } = await exportBackup()
      await saveFile(blob, name)
      this.setState({ note: '备份已导出。' })
    } catch (e) {
      this.setState({
        note: `导出失败：${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      this.setState({ exporting: false })
    }
  }

  render() {
    const { error, exporting, note } = this.state
    if (!error) return this.props.children
    return (
      <main className="mx-auto min-h-dvh max-w-md px-4 py-6">
        <h1 className="px-title text-[24px]">足迹手账</h1>
        <div className="px-card mt-5 bg-lemon p-4">
          <p className="px-title text-[20px]">页面出错了</p>
          <p className="mt-2 text-sm">
            你的记录和照片还在这台设备里，没有丢。重新打开通常就能恢复；如果反复出错，先导出一份备份。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="px-btn bg-berry"
              onClick={() => location.reload()}
            >
              重新打开
            </button>
            <button
              type="button"
              className="px-btn"
              disabled={exporting}
              aria-busy={exporting}
              onClick={() => void this.exportBackup()}
            >
              {exporting ? '导出中…' : '导出备份'}
            </button>
          </div>
          {note && <p className="mt-3 text-sm">{note}</p>}
          <p className="mt-4 text-xs break-words text-ink-soft">
            出错信息：{error.message}
          </p>
        </div>
      </main>
    )
  }
}
