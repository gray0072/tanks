import { Box, Typography } from '@mui/material';
import { useGameStore, SPEED_BUFF_DUR, FIRE_BUFF_DUR } from '../store/useGameStore';

function BuffIndicator({ label, color, value, max }: {
  label: string; color: string; value: number; max: number;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography sx={{ color, fontSize: 8 }}>{label}</Typography>
      <Box sx={{ width: 40, height: 5, background: '#333', border: '1px solid #555' }}>
        <Box sx={{ height: '100%', width: `${(value / max) * 100}%`, background: color, transition: 'width 0.1s' }} />
      </Box>
    </Box>
  );
}

export default function BuffBar() {
  const speedBuff = useGameStore(s => s.playerSpeedBuff);
  const fireBuff  = useGameStore(s => s.playerFireBuff);

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 0.5, justifyContent: 'center', alignItems: 'center', height: 24 }}>
      {speedBuff > 0 && (
        <BuffIndicator label="⚡SPEED" color="#0cf" value={speedBuff} max={SPEED_BUFF_DUR} />
      )}
      {fireBuff > 0 && (
        <BuffIndicator label="🔥FIRE" color="#f80" value={fireBuff} max={FIRE_BUFF_DUR} />
      )}
    </Box>
  );
}
