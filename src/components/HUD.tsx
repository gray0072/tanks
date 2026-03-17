import { Box, Typography } from '@mui/material';
import { useGameStore, FLAG_HP } from '../store/useGameStore';

function FlagBar({ hp, color }: { hp: number; color: string }) {
  const pct = Math.max(0, (hp / FLAG_HP) * 100);
  return (
    <Box sx={{ width: 80, height: 10, background: '#333', border: '1px solid #555' }}>
      <Box sx={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.2s' }} />
    </Box>
  );
}

export default function HUD() {
  const greenHp = useGameStore(s => s.greenFlagHp);
  const redHp   = useGameStore(s => s.redFlagHp);

  return (
    <Box sx={{ display: 'flex', gap: 5, mb: 0.5, alignItems: 'center', justifyContent: 'center' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ color: '#4f4', fontSize: 11 }}>GREEN</Typography>
        <FlagBar hp={greenHp} color="#4f4" />
      </Box>
      <Typography sx={{ color: '#555', fontSize: 11 }}>VS</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FlagBar hp={redHp} color="#f44" />
        <Typography sx={{ color: '#f44', fontSize: 11 }}>RED</Typography>
      </Box>
    </Box>
  );
}
