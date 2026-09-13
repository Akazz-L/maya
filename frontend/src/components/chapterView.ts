/** Which pane fills the chapter workspace: the prose, its plan, or its issues. */
export type ChapterView = 'write' | 'plan' | 'issues';

/** Ids tying each view's tab in the toolbar to the panel it shows. */
export const chapterTabId = (view: ChapterView) => `chapter-tab-${view}`;
export const chapterPanelId = (view: ChapterView) => `chapter-panel-${view}`;
