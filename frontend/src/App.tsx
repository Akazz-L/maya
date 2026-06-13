import { BiblePanel } from './components/BiblePanel';
import { ChapterPanel } from './components/ChapterPanel';

export function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f5f0]">
      <BiblePanel />
      <ChapterPanel />
    </div>
  );
}
