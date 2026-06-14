import { ListField } from './ListField';

interface Props {
  timeline: string[];
  onChange: (timeline: string[]) => void;
}

export function TimelineSection({ timeline, onChange }: Props) {
  return (
    <section id="timeline" className="mb-10">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">
        📅 Timeline
      </h2>
      <ListField
        label="Events"
        items={timeline}
        addLabel="+ Add event"
        onChange={onChange}
      />
    </section>
  );
}
