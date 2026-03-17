import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#0a0a0a', paper: '#111' },
    primary:  { main: '#4f4' },
    error:    { main: '#f44' },
    info:     { main: '#0cf' },
    warning:  { main: '#f80' },
  },
  typography: {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 10,
  },
});

export default theme;
