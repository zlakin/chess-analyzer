import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { AnalyzedMove } from '../../../shared/types'
import { whiteWinPercent } from '../lib/displayEval'

interface EvalGraphProps {
  moves: AnalyzedMove[]
  currentPly: number
  onSelectPly: (ply: number) => void
}

export function EvalGraph({ moves, currentPly, onSelectPly }: EvalGraphProps): JSX.Element {
  const data = moves.map((move) => ({
    ply: move.ply,
    whiteWinPercent: whiteWinPercent(move.evalAfter, move.color === 'w' ? 'b' : 'w')
  }))

  return (
    <div className="eval-graph">
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart
          data={data}
          onClick={(state) => {
            const ply = state?.activeLabel
            if (typeof ply === 'number') onSelectPly(ply)
          }}
        >
          <XAxis dataKey="ply" hide />
          <YAxis domain={[0, 100]} hide />
          <ReferenceLine y={50} stroke="var(--border-strong)" strokeDasharray="3 3" />
          <ReferenceLine x={currentPly} stroke="var(--accent)" />
          <Tooltip
            formatter={(value) => {
              if (typeof value === 'number') return `${value.toFixed(0)}%`
              return ''
            }}
            labelFormatter={(ply) => `Move ${ply}`}
          />
          <Area
            type="stepAfter"
            dataKey="whiteWinPercent"
            stroke="var(--text)"
            fill="var(--text)"
            fillOpacity={0.85}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
