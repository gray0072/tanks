import { Box, Button, Typography } from '@mui/material';
import { useGameStore } from '../store/useGameStore';
import { sendMsg } from '../net/socket';

export default function LobbyOverlay() {
  const phase = useGameStore(s => s.phase);
  const playerCount = useGameStore(s => s.lobbyPlayerCount);

  if (phase !== 'lobby') return null;

  return (
    <Box sx={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 3, background: 'rgba(0,0,0,0.85)', zIndex: 10,
    }}>
      <Typography sx={{ fontFamily: '"Press Start 2P", monospace', fontSize: 20, color: '#eee' }}>
        LOBBY
      </Typography>
      <Typography sx={{ color: '#aaa', fontSize: 11 }}>
        {playerCount} / 10 player{playerCount !== 1 ? 's' : ''} connected
      </Typography>
      <Typography sx={{ color: '#666', fontSize: 9, textAlign: 'center', maxWidth: 300 }}>
        Empty slots will be filled with bots.
        <br />Any player can press START.
      </Typography>
      <Button
        variant="outlined"
        onClick={() => sendMsg({ type: 'START' })}
        sx={{
          fontFamily: '"Press Start 2P", monospace', fontSize: 12,
          borderRadius: 0, borderColor: '#4f4', color: '#4f4',
          '&:hover': { borderColor: '#6f6', background: '#0a200a' },
        }}
      >
        START GAME
      </Button>
    </Box>
  );
}
