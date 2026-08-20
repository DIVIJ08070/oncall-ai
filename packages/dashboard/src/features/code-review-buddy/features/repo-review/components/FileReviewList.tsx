import type { FileReviewResult } from '../../../lib/types';
import { FileReviewCard } from './FileReviewCard';

interface FileReviewListProps {
  files: FileReviewResult[];
}

/** File cards sorted worst score first. */
export function FileReviewList({ files }: FileReviewListProps) {
  const sorted = [...files].sort((a, b) => a.score - b.score);

  return (
    <div className="space-y-3">
      {sorted.map((file) => (
        <FileReviewCard key={file.filePath} file={file} />
      ))}
    </div>
  );
}
