import { Box, Typography } from '@mui/material';
import { useGameStore } from '../store/useGameStore';

export default function RespawnMessage() {
  const dead  = useGameStore(s => s.playerDead);
  const timer = useGameStore(s => s.playerRespawnTimer);

  if (!dead) return null;

  return (
    <Box sx={{
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 5, pointerEvents: 'none',
    }}>
      <Typography sx={{
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 16, color: '#ff0',
        textShadow: '0 0 10px #ff0',
      }}>
        RESPAWN IN {Math.ceil(timer / 20)}
      </Typography>
    </Box>
  );
}
