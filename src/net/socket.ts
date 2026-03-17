import PartySocket from 'partysocket';
import type { C2S, S2C } from '../game/types';

let socket: PartySocket | null = null;
const handlers: ((msg: S2C) => void)[] = [];

export function createSocket(host: string, room: string): PartySocket {
  if (socket) {
    socket.close();
    handlers.length = 0;
  }
  socket = new PartySocket({ host, room });
  socket.addEventListener('message', (evt: MessageEvent) => {
    const msg: S2C = JSON.parse(evt.data as string);
    handlers.forEach(h => h(msg));
  });
  return socket;
}

export function getSocket(): PartySocket | null {
  return socket;
}

export function sendMsg(msg: C2S): void {
  socket?.send(JSON.stringify(msg));
}

export function onSocketMessage(handler: (msg: S2C) => void): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}
