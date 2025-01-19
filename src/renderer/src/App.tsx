import { Content, RootLayout, Sidebar } from './components'
import CMImageContextMenu from './components/CMImageContextMenu'
import Editor from './components/myEditor'
import { notesDirectoryPath } from '@shared/constants'
import { FileExplorer } from './components/FileExplorer'
import { useFileExplorer } from './hooks/useFileExplorer'
import { useEffect } from 'react'
import { storeFilesInDB } from '../utils/db'
import SearchWindow from './components/SearchWindow'
import useSearchField from './hooks/useSearchField'
import './assets/index.css'

function App() {
  const { text, setText, openFile, currentFilename } = useFileExplorer()
  const { toggleVisibility, onQueryChange, isVisible, setIsVisible, results } = useSearchField();

  useEffect(() => {
    const load = async () => {
      const files = await window['api'].getFilesRecursive(notesDirectoryPath);
      storeFilesInDB(files)
    }
    load()
  }, [])

  return (
    <RootLayout>
      <SearchWindow isVisible={isVisible} setIsVisible={setIsVisible} onQueryChange={onQueryChange} results={results} onFileSelect={openFile}/> 
      <CMImageContextMenu />
      <Sidebar>
        <FileExplorer directoryPath={notesDirectoryPath} onFileSelect={openFile} onSearchClick={toggleVisibility}/>
        {/* <TreePresenter itemSize={30} directoryPath={notesDirectoryPath}/> */}
      </Sidebar>
      <Content>
        <Editor text={text} setText={setText} currentFilename={currentFilename} />
      </Content>
    </RootLayout>
  )
}

export default App
