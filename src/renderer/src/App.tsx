import { Content, RootLayout, Sidebar } from './components'
import CMImageContextMenu from './components/CMImageContextMenu'
import Editor from './components/myEditor'
import { notesDirectoryPath } from '@shared/constants'
import { FileExplorer } from './components/FileExplorer'
import VirtualizedList from './components/VirrtualizedList'
import TreePresenter from './components/VirrtualizedList'
import { useFileExplorer } from './hooks/useFileExplorer'

function App() {
  const { text, setText, openFile, currentFilename } = useFileExplorer()

  return (
    <RootLayout>
      <CMImageContextMenu />
      <Sidebar>
        <FileExplorer directoryPath={notesDirectoryPath} onFileSelect={openFile} />
        {/* <TreePresenter itemSize={30} directoryPath={notesDirectoryPath}/> */}
      </Sidebar>
      <Content>
        <Editor text={text} setText={setText} currentFilename={currentFilename} />
      </Content>
    </RootLayout>
  )
}

export default App
