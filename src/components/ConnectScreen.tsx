import { useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import { useGameStore } from '../store/useGameStore';
import { createSocket, onSocketMessage, sendMsg } from '../net/socket';
import type { S2C } from '../game/types';

const HOST = import.meta.env.VITE_PARTYKIT_HOST as string;

export default function ConnectScreen() {
  const [name, setName] = useState('');
  const setPhase = useGameStore(s => s.setPhase);
  const setMySlot = useGameStore(s => s.setMySlot);
  const setLobby = useGameStore(s => s.setLobby);
  const setWalls = useGameStore(s => s.setWalls);

  function connect() {
    const trimmed = name.trim() || 'Player';
    createSocket(HOST, 'game');

    onSocketMessage((msg: S2C) => {
      if (msg.type === 'WELCOME') {
        setMySlot(msg.slotId, msg.connId);
        sendMsg({ type: 'SET_NAME', name: trimmed });
        setPhase('lobby');
      } else if (msg.type === 'LOBBY') {
        setLobby(msg.playerCount);
      } else if (msg.type === 'GAME_START') {
        setWalls(msg.walls);
        setMySlot(msg.mySlot, useGameStore.getState().myConnId);
        setPhase('playing');
      }
    });
  }

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', background: '#0a0a0a', gap: 3,
    }}>
      <Typography sx={{ fontFamily: '"Press Start 2P", monospace', fontSize: 20, color: '#eee' }}>
        TANKS
      </Typography>
      <Typography sx={{ color: '#4f4', fontSize: 11 }}>5v5 · Destroy the enemy flag</Typography>
      <TextField
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && connect()}
        placeholder="Your name"
        variant="outlined"
        size="small"
        inputProps={{ maxLength: 20 }}
        sx={{
          width: 220,
          '& .MuiOutlinedInput-root': { color: '#eee', borderRadius: 0 },
          '& fieldset': { borderColor: '#555' },
          '& input::placeholder': { color: '#666' },
        }}
      />
      <Button
        variant="outlined"
        onClick={connect}
        sx={{
          fontFamily: '"Press Start 2P", monospace', fontSize: 11,
          borderRadius: 0, borderColor: '#4f4', color: '#4f4',
          '&:hover': { borderColor: '#6f6', background: '#0a200a' },
        }}
      >
        JOIN GAME
      </Button>
    </Box>
  );
}
