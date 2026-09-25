/** Which pane fills the chapter workspace: the prose, its plan, or the summary
 *  later chapters read in place of the prose.
 *  A review's findings are not a pane — they are drawn in the prose itself. */
export type ChapterView = 'write' | 'plan' | 'summary';

/** Ids tying each view's tab in the toolbar to the panel it shows. */
export const chapterTabId = (view: ChapterView) => `chapter-tab-${view}`;
export const chapterPanelId = (view: ChapterView) => `chapter-panel-${view}`;
