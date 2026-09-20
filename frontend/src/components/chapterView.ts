/** Which pane fills the chapter workspace: the prose, or its plan.
 *  A review's findings are not a pane — they are drawn in the prose itself. */
export type ChapterView = 'write' | 'plan';

/** Ids tying each view's tab in the toolbar to the panel it shows. */
export const chapterTabId = (view: ChapterView) => `chapter-tab-${view}`;
export const chapterPanelId = (view: ChapterView) => `chapter-panel-${view}`;
