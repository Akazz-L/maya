import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import type { Me, ModelKey } from '../api/types';
import { AccountMenu } from './AccountMenu';
import { ModelPicker } from './ModelPicker';
import { UsageMeter } from './UsageMeter';

interface WorkspaceHeaderProps {
  projectName: string | undefined;
  me: Me | undefined;
  savingModel: boolean;
  onModelChange: (key: ModelKey) => void;
}

/** The project's name, and the writer's model and budget, which apply to every AI call. */
export function WorkspaceHeader({ projectName, me, savingModel, onModelChange }: WorkspaceHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line-soft bg-surface px-3 sm:px-4">
      <Link
        to="/"
        className="flex h-8 items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-ink/6 hover:text-ink"
      >
        <ChevronLeft aria-hidden className="size-4" />
        <span className="max-sm:sr-only">Projects</span>
      </Link>
      <span aria-hidden className="h-5 w-px bg-line max-sm:hidden" />
      <h1 className="min-w-0 truncate font-serif text-[17px] font-semibold tracking-tight">
        {projectName ?? '…'}
      </h1>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {me && (
          <>
            <ModelPicker
              models={me.models}
              value={me.model_key}
              saving={savingModel}
              onChange={onModelChange}
            />
            <UsageMeter usage={me.usage} />
          </>
        )}
        <AccountMenu />
      </div>
    </header>
  );
}
