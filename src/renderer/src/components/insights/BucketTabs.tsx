import { useState } from 'react'
import type { InsightsBucket, InsightsBucketKey } from '../../../../shared/types'
import { BUCKET_LABELS } from '../../lib/insightsBucketLabels'
import { TimeControlSection } from './TimeControlSection'

interface BucketTabsProps {
  buckets: InsightsBucket[]
}

export function BucketTabs({ buckets }: BucketTabsProps): JSX.Element | null {
  const [selectedKey, setSelectedKey] = useState<InsightsBucketKey>('overall')

  const selected = buckets.find((bucket) => bucket.key === selectedKey)
  if (!selected) return null

  return (
    <div className="bucket-tabs">
      <nav className="segmented-control">
        {buckets.map((bucket) => (
          <button
            key={bucket.key}
            className={`segmented-control-option${bucket.key === selectedKey ? ' active' : ''}`}
            onClick={() => setSelectedKey(bucket.key)}
          >
            {BUCKET_LABELS[bucket.key]}
          </button>
        ))}
      </nav>
      {/* Keyed on the bucket so switching tabs remounts the panel fresh -
          otherwise an expanded "show more" state from one bucket would
          silently carry over to whichever bucket is selected next. */}
      <TimeControlSection key={selected.key} bucket={selected} />
    </div>
  )
}
