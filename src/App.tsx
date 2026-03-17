import { Box, Typography } from '@mui/material';
import { useGameStore } from './store/useGameStore';
import HUD from './components/HUD';
import BuffBar from './components/BuffBar';
import GameCanvas from './components/GameCanvas';
import RespawnMessage from './components/RespawnMessage';
import WinOverlay from './components/WinOverlay';
import ConnectScreen from './components/ConnectScreen';
import LobbyOverlay from './components/LobbyOverlay';

export default function App() {
  const phase = useGameStore(s => s.phase);

  if (phase === 'idle') return <ConnectScreen />;

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', background: '#0a0a0a',
    }}>
      {phase === 'playing' && (
        <>
          <HUD />
          <BuffBar />
          <Typography sx={{ fontSize: 8, color: '#888', mb: 0.5 }}>
            WASD — move · MOUSE — aim · LMB — fire · Pick up bonuses!
          </Typography>
        </>
      )}
      <GameCanvas />
      <RespawnMessage />
      <WinOverlay />
      <LobbyOverlay />
    </Box>
  );
}
