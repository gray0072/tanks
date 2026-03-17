import { Box, Typography } from '@mui/material';
import { useGameStore } from '../store/useGameStore';

export default function WinOverlay() {
  const gameOver = useGameStore(s => s.gameOver);
  const winner   = useGameStore(s => s.winner);

  if (!gameOver) return null;

  const winnerColor = winner === 0 ? '#4f4' : '#f44';
  const winnerLabel = winner === 0 ? 'GREEN' : 'RED';

  return (
    <Box sx={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 3, background: 'rgba(0,0,0,0.8)', zIndex: 10,
    }}>
      <Typography sx={{ fontFamily: '"Press Start 2P", monospace', fontSize: 22 }}>
        <Box component="span" sx={{ color: winnerColor }}>{winnerLabel}</Box> WINS!
      </Typography>
      <Typography sx={{ color: '#888', fontSize: 10 }}>
        Returning to lobby…
      </Typography>
    </Box>
  );
}
